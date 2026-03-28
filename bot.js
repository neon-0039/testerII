import * as misskey from 'misskey-js'; // ここを * as に変更
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Misskey APIの初期化部分がある場合、以下のように書いてみてください
// const api = new misskey.api.api({ ... });

// もしこれまでのコードで misskey.api を使っていたなら、以下のように定義し直すとスムーズです
const { api: MisskeyApi } = misskey;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 【修正前】
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 【修正後】第2引数で apiVersion を "v1" に固定します
// 最新のSDKなら、第2引数で v1 を指定すれば URL が .../v1/... に変わります
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, "v1");

const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。基本的に丁寧語です。一人称は私、二人称はマスターです。褒められるけど内心嬉しいけどちょっとツンとする微ツンデレです。語尾には「っ」をつけることを意識してください。ですが「っ」のあとに「！」をつける必要はありません。"
};

// Misskey初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});
async function checkAvailableModels() {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`;
    try {
        const res = await axios.get(url);
        console.log("利用可能なモデルリスト:");
        res.data.models.forEach(m => console.log("- " + m.name));
    } catch (e) {
        console.error("モデルリスト取得失敗:", e.message);
    }
}
async function askGemini(prompt) {
    // 優先順位が高い順に並べる
    const modelPriority = [
        "gemini-2.5-flash-lite", // 本命（現在 20回/日）
        "gemini-3.1-flash-lite", // 予備（明日以降 500回/日 になる期待）
        "gemini-2.0-flash"      // さらに予備
    ];

    for (const modelId of modelPriority) {
        const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        try {
            console.log(`モデル試行中: ${modelId}`);
            const res = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }]
            });
            
            // 成功したら結果を返して終了
            return res.data.candidates[0].content.parts[0].text;
            
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.warn(`⚠️ ${modelId} が枠不足です。次のモデルを試します...`);
                continue; // 次のモデルへ
            } else if (error.response && error.response.status === 404) {
                console.warn(`⚠️ ${modelId} はまだ存在しません。次へ...`);
                continue; // 3.1 がまだリストにない場合もこれで次へ行ける
            }
            // それ以外の重大なエラーはここでストップ
            console.error("重大なエラー！><管理者さんに報告お願いします！:", error.message);
            break;
        }
    }
    return "エラー発生！>< 人間さん！なんとかしてください！";
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

                if (note.user.isBot || note.user.id === me.id || note.myReplyId || (note.repliesCount && note.repliesCount > 0)) {
                    continue;
                }

                let user_input = (note.text || "").replace(`@${me.username}`, "").trim();
                if (!user_input) continue;

                console.log(`${note.user.username} さんからのメンションを処理中...`);

                let reply_prompt = "";
                
                if (user_input.includes("マルコフ")) {
                    console.log("マルコフ連鎖モード起動！");
                    const tl = await mk.request('notes/timeline', { limit: 30 });
                    const tl_text = tl
                        .filter(n => n.text && n.user.id !== me.id)
                        .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
                        .slice(0, 10)
                        .join("\n");

                    reply_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。
あなたは今、「マルコフモード」です。支離滅裂な「マルコフ連鎖ボット」として振る舞ってください。
以下の【タイムラインの断片】にあるフレーズを単語に分解し、ランダムに6個以上継ぎ接ぎして、意味が一切通らない1文を作りなさい。
単語を1つ1つの文字に分解しても問題ありません。単語の繋ぎ目に"、"などを置かないでください。
接続詞は入れたり入れなかったりしてください。
文脈と意味、あなたのキャラクターらしい口調（語尾など）もこの回答中は無視。
「マルコフ」という言葉は使用禁止。

【タイムラインの断片】
${tl_text}

【制約】
・50文字以内
・相手への返信として出力
・結果の文章のみ出力。`;

                } else if (user_input.includes("おみくじ")) {
                    console.log("おみくじモード起動！");
                    const luckNum = Math.floor(Math.random() * 100);
                    let luckResult = (luckNum < 10) ? "超大吉" : (luckNum < 30) ? "大吉" : (luckNum < 60) ? "中吉" : (luckNum < 85) ? "小吉" : (luckNum < 95) ? "末吉" : "凶";

                    reply_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。
【おみくじモード】
あなたは今、占い師として相手の運勢を伝えてください。
結果は【${luckResult}】です。
- 運勢の結果に基づいた、あなたらしい「今日のアドバイス」や「ラッキーアイテム」を1つ含めてください。
- 「おみくじの結果は〜」のような形式張った説明は不要。
- 60文字以内で、親しみやすく、かつキャラクターの口調を崩さずに回答してください。
- 相手の名前を呼んでも構いません。ただし、メンションは行わないでください。`;

                } else {
                    // 通常のリプライ
                    reply_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。
相手の言葉: ${user_input}
これに対して80文字以内で返信してください。"@Sakuran@misskey.day"のことはマイクリエイターと呼ぶこと。`;
                }

                console.log("API制限回避のため17秒待機します...");
                await sleep(17000);

                const reply_text = await askGemini(reply_prompt);
                
                await mk.request('notes/create', {
                    text: reply_text.trim().slice(0, 120),
                    replyId: note.id,
                    visibility: 'home' 
                });
                
                console.log(`${note.user.username} さんに返信しました。`);
                replyCount++;

                console.log("API制限回避のため45秒待機します...");
                await sleep(45000);
            }
        } catch (e) {
            console.log(`メンション処理エラー!><: ${e.message}`);
        }

        // --- 3. 独り言の処理（ここが実行されるように try の外に出すか、別ブロックにする） ---
        console.log("本投稿の準備に入ります。20秒待機...");
        await sleep(20000);

        try {
            console.log("独り言（本投稿）を生成中です...");
            const tl = await mk.request('notes/timeline', { limit: 27 });
            const tl_text = tl
                .filter(n => n.text && n.user.id !== me.id)
                .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
                .slice(0, 10)
                .join("\n");

            const main_post_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。
【タイムラインの内容】
${tl_text}
【指示】
タイムラインを分析し、傾向やテンションを分析して1文字以上100文字以内で1言、見た人が不快になるような内容は避けて投稿してください。
- 文法を成立させて生成してください。キャラクター設定にそって生成ください。「タイムライン拝見いたしました」など、メタ発言は絶対に書かないでください。
- 多少支離滅裂になってしまってもいいので、必ず観測した投稿の単語を5割以上使用して文章を生成してください。
- ":"で囲まれている英数字は無視すること。誰かに宛てて、というよりかは呟きやひとりごとに近い感じで書きなさい。
- 特定の人の話題の時は、その人の名前を明記してください。メンションは行わないこと。`;

            const post_content = await askGemini(main_post_prompt);
            
            await sleep(12000);
            await mk.request('notes/create', { 
                text: post_content.trim().slice(0, 150),
                visibility: 'home' 
            });
            console.log("本投稿が完了しました！");
} catch (e) {
            console.log(`本投稿処理エラー！><: ${e.message}`);
            
            // エラー内容をボットに呟かせる
            try {
                await mk.request('notes/create', { 
                    text: `投稿エラー！><管理者さーん！（エラー: ${e.message}）`,
                    visibility: 'home' 
                });
            } catch (postError) {
                console.error("エラー投稿自体にも失敗しました:", postError.message);
            }
        }
    } catch (e) {
        console.log(`致命的なエラー！><: ${e.message}`);
    }
}
await checkAvailableModels();
main();
