const misskey = require('misskey-js');
const axios = require('axios');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。基本的に丁寧語です。一人称は私、二人称はマスターです。"
};

// Misskey初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

/**
 * Gemini API に直接リクエストを送る関数
 */
async function askGemini(prompt) {
    
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${config.geminiKey}`;
    
    const payload = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    try {
        const response = await axios.post(url, payload);
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        if (error.response) {
            // ここで出るエラーが 404 ならモデル名、429 なら回数制限です
            console.error("Gemini Error:", JSON.stringify(error.response.data));
        }
        throw error;
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
            // 少し多めに取得して、その中から未返信の最新4件を探す
            const mentions = await mk.request('notes/mentions', { limit: 10 });
            let replyCount = 0;

            for (const note of mentions) {
                // 4つ返信したら終了
                if (replyCount >= 4) break;

                // 自分、Bot、または既に返信済み(myReplyId)ならスキップ
                if (note.user.isBot || note.user.id === me.id || note.myReplyId) {
                    continue;
                }

                // メンション部分を除去
                let user_input = (note.text || "").replace(`@${me.username}`, "").trim();
                if (!user_input) continue;

                console.log(`${note.user.username} さんからのメンションを処理中... (${replyCount + 1}/4)`);

                // Geminiに返信を考えてもらう
                const reply_prompt = `${config.characterSetting}\n相手の言葉: ${user_input}\nこれに対して80文字以内で返信してください。"@Sakuran@misskey.day"というユーザーへの二人称は「マイクリエイター」とすること。"足立レイ"、"九十九シオン"というキャラクター名の2人のうちどちらかもしくは両方が話題に上がった時、2人のことは先輩と呼ぶこと。`;
                const reply_text = await askGemini(reply_prompt);
                
                // 返信を投稿（ホーム公開固定）
                await mk.request('notes/create', {
                    text: reply_text.trim().slice(0, 120),
                    replyId: note.id,
                    visibility: 'home' 
                });
                
                console.log(`${note.user.username} さんに返信しました。`);
                
                // カウントを増やして、40秒待機（429エラー対策）
                replyCount++;
                console.log("API制限回避のため25秒待機します...");
                await sleep(40000);
            }
        } catch (e) {
            console.log(`メンション処理中にエラーが発生しました: ${e.message}`);
        }
        // 連投制限対策で45秒待つ
        await sleep(45000);
        replyCount=0;
        // --- 3. 独り言の処理 ---
        console.log("投稿を生成中です...");
        try {
            const tl = await mk.request('notes/timeline', { limit: 27 });
            const tl_text = tl.map(n => n.text).filter(t => t).join("\n");
            const prompt = `
            ${config.characterSetting}
            【タイムラインの内容】
            ${tl_text}
            【指示】
            タイムラインを分析し、傾向やテンションを分析してキャラ設定に従って1言投稿してください。
            - 100文字以内。見た人が不快になるような内容は避けてください。
            - 多少支離滅裂になってしまっても問題ありませんので、必ず観測した投稿の単語をのみを使用して文章を生成してください。
            - 特定の人の話題の時は、その人の名前を明記してください。ただし、メンションは行わないこと。
            - "@Sakuran@misskey.day"というユーザーへの二人称は「マイクリエイター」とすること。
            - "足立レイ"、"九十九シオン"というキャラクター名の2人のうちどちらかもしくは両方が話題に上がった時、2人のことは先輩と呼ぶこと。
            - 少し機械的に、すこし観察するような視点で。
            `;

            const post_content = await askGemini(prompt);
            // 【追加】連投制限対策で25秒待つ
            await sleep(25000);

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
