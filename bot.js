const misskey = require('misskey-js');
const axios = require('axios');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 【修正前】
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 【修正後】第2引数で apiVersion を "v1" に固定します
// 最新のSDKなら、第2引数で v1 を指定すれば URL が .../v1/... に変わります
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, "v1");

const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" });
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。基本的に丁寧語です。一人称は私、二人称はマスターです。褒められるけど照れるけどちょっとツンとする微ツンデレです。"
};

// Misskey初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

async function askGemini(prompt) {
    // SDKを使わず、直接 v1 の URL を組み立てる（これが一番確実）
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        const res = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }]
        });
        
        // 成功したらテキストを返す
        if (res.data && res.data.candidates && res.data.candidates[0].content) {
            return res.data.candidates[0].content.parts[0].text;
        }
        return "……（考え中）";
    } catch (error) {
        // ここで 404 が出たら名前間違い、429 が出たら枠不足（Limit 0）です
        if (error.response) {
            console.error("Gemini API Error:", JSON.stringify(error.response.data));
        } else {
            console.error("Gemini Error:", error.message);
        }
        return "……（エラーが発生しました）";
    }
}
async function main() {
    async function debugModels() {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const res = await axios.get(url);
        
        console.log("利用可能なモデル一覧:", res.data.models.map(m => m.name));
    }
    try {
        const me = await mk.request('i');
        const my_id = me.id;
        const my_username = me.username;
        console.log(`Logged in as: @${my_username}`);

        // --- 1. 自動フォロバ処理 ---
        console.log("未フォローのフォロワーを確認中...");
        try {
            const followers = await mk.request('users/followers', { userId: my_id, limit: 10 });
            for (const f of followers) {
                const target = f.follower;
                if (target && !target.isFollowing && !target.isBot && target.id !== my_id) {
                    await mk.request('following/create', { userId: target.id })
                        .then(() => console.log(`Followed back: ${target.username}`))
                        .catch(e => console.log(`Follow back failed: ${e.message}`));
                }
            }
        } catch (e) {
            console.log("フォロバ処理スキップ。");
        }

// --- 2. メンション取得・返信 ---
        console.log("メンション確認中...");
        try {
            const mentions = await mk.request('notes/mentions', { limit: 10 });
            let replyCount = 0;

            for (const note of mentions) {
                if (replyCount >= 4) break;

                // 自分/Bot/既読/返信済み はスルー
                if (
                    note.user.isBot || 
                    note.user.id === me.id || 
                    note.myReplyId || 
                    (note.repliesCount && note.repliesCount > 0)
                ) {
                    continue;
                }

                let user_input = (note.text || "").replace(`@${me.username}`, "").trim();
                if (!user_input) continue;

                console.log(`${note.user.username} さんからのメンションを処理中...`);

                let reply_prompt = "";
                console.log("API制限回避のため50秒待機します...");
                await sleep(50000);
                // 【新機能】特定のワード「マルコフ」が含まれているか判定
                if (user_input.includes("マルコフ")) {
                    console.log("マルコフ連鎖モード起動！TLを取得します...");
                    const tl = await mk.request('notes/timeline', { limit: 12 });
                    // 【さらに軽量化】URLや過度な空白を削除してトークンを節約
                    const tl_text = tl
                        .filter(n => n.text && n.user.id !== me.id)
                        .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim()) // URL除去
                        .slice(0, 10) // 20件取得しても、Geminiに渡すのは「厳選した10件」にする
                        .join("\n");
                    
                    reply_prompt = `
${config.characterSetting}
あなたは今支離滅裂な「マルコフ連鎖ボット」として振る舞って。
以下の【タイムラインの断片】にある単語やフレーズをランダムに継ぎ接ぎして、意味が一切通らない、1文を作って。
文脈と文法、意味、あなたのキャラクターらしい口調（語尾など）も無視。

【タイムラインの断片】
${tl_text}

【制約】
・60文字以内
・相手への返信として出力
・「マルコフ連鎖です」等の説明は不要。結果の文章のみ出力。`;
                } else {
                    // 通常の返信
                    reply_prompt = `${config.characterSetting}\n相手の言葉: ${user_input}\nこれに対して80文字以内で返信してください。`;
                }

                const reply_text = await askGemini(reply_prompt);
                
                await mk.request('notes/create', {
                    text: reply_text.trim().slice(0, 120),
                    replyId: note.id,
                    visibility: 'home' 
                });
                
                console.log(`${note.user.username} さんに返信しました。`);
                
                replyCount++;
                console.log("API制限回避のため120秒待機します...");
                await sleep(120000);
            }
        } catch (e) {
            console.log(`メンション処理中にエラーが発生しました: ${e.message}`);
        }

        // 本投稿（独り言）の前に、直前のリプから間隔を空ける
        console.log("本投稿の準備に入ります。120秒待機...");
        await sleep(120000);
        // --- 3. 独り言の処理 ---
        console.log("投稿を生成中です...");
        try {
            const tl = await mk.request('notes/timeline', { limit: 12 });
            
            // 【さらに軽量化】URLや過度な空白を削除してトークンを節約
            const tl_text = tl
                .filter(n => n.text && n.user.id !== me.id)
                .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim()) // URL除去
                .slice(0, 10) // 20件取得しても、Geminiに渡すのは「厳選した10件」にする
                .join("\n");
            
            const prompt = `
            ${config.characterSetting}
            【タイムラインの内容】
            ${tl_text}
            【指示】
            タイムラインを分析し、傾向やテンションを分析して100文字以内で1言、見た人が不快になるような内容は避けて投稿してください。
            - 多少支離滅裂になってしまってもいいので、必ず観測した投稿の単語を7割以上使用して文章を生成して。
            - 特定の人の話題の時は、その人の名前を明記してください。ただし、メンションは行わないこと。
            - "足立レイ"、"九十九シオン"というキャラクター名が話題に上がった時、2人のことは先輩と呼ぶこと。
            `;

            const post_content = await askGemini(prompt);
            // 【追加】連投制限対策で12秒待つ
            await sleep(12000);

            // --- 3. 独り言の投稿の箇所 ---
            await mk.request('notes/create', { 
                text: post_content.trim().slice(0, 150),
                visibility: 'home' // 【追加】独り言をホーム公開（フォロワー限定に近い状態）に固定
            });

            
        } catch (e) {
            console.log(`投稿生成エラー: ${e.message}`);
        }

    } catch (e) {
        console.log(`全体エラー: ${e.message}`);
    }
}

main();
