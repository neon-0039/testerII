const misskey = require('misskey-js');
const axios = require('axios');

// 環境変数から設定を読み込み
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    characterSetting: "好きに回答してください" // CHARACTER_SETTING
};

// Misskey初期化 (認証エラー回避版)
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

/**
 * Gemini APIに直接POSTリクエストを送る関数
 * 404回避のため、URLを完全に固定しています
 */
async function askGemini(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${config.geminiKey}`;
    
    const payload = {
        contents: [{
            parts: [{ text: prompt }]
        }]
    };

    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
    });

    // 生成されたテキストを抽出
    return response.data.candidates[0].content.parts[0].text;
}

async function main() {
    try {
        // 1. 自分の情報を取得
        const me = await mk.request('i');
        const my_id = me.id;
        const my_username = me.username;

        // --- 自動フォロバ処理 ---
        console.log("未フォローのフォロワーを確認中...");
        try {
            const followers = await mk.request('users/followers', { userId: my_id, limit: 10 });
            for (const f of followers) {
                const target = f.follower;
                if (target && !target.isFollowing && !target.isBot && target.id !== my_id) {
                    await mk.request('following/create', { userId: target.id });
                    console.log(`Followed back: ${target.username}`);
                }
            }
        } catch (e) {
            console.log("フォロバ処理スキップ。");
        }

        // --- メンション取得 & 返信 ---
        console.log("メンションを確認中...");
        let mentions = [];
        try {
            mentions = await mk.request('notes/mentions', { limit: 10 });
        } catch (e) {
            mentions = [];
        }

        for (const note of mentions) {
            if (note.user.isBot || note.user.id === my_id) continue;

            let user_input = note.text || "";
            user_input = user_input.replace(`@${my_username}`, "").trim();
            if (!user_input) continue;

            // Python版と同じプロンプト
            const reply_prompt = `${config.characterSetting}\n相手の言葉: ${user_input}\nこれに対して75文字以内で返信してください。`;
            
            const reply_text = await askGemini(reply_prompt);
            const final_reply = reply_text.trim().slice(0, 75);

            await mk.request('notes/create', {
                text: final_reply,
                replyId: note.id
            });
            console.log(`Replied to ${note.user.username}`);
        }

    } catch (e) {
        console.log(`リプライエラー。: ${e.message}`);
        if (e.response) console.log("詳細:", JSON.stringify(e.response.data));
    }

    // --- 独り言の処理 ---
    console.log("投稿を生成中です...");
    try {
        // タイムライン取得
        const tl = await mk.request('notes/timeline', { limit: 20 });
        const tl_text = tl.map(n => n.text).filter(t => t).join("\n");

        // Python版と同じプロンプト
        const prompt = `
        ${config.characterSetting}
        【タイムラインの内容】
        ${tl_text}
        【指示】
        タイムラインを分析し、キャラ設定に従って1言投稿してください。
        - 75文字以内。相手が不快になるような内容は避けてください。
        `;

        const post_raw = await askGemini(prompt);
        const post_content = post_raw.trim().slice(0, 75);

        await mk.request('notes/create', { text: post_content });
        console.log(`Posted: ${post_content}`);

    } catch (e) {
        console.log(`投稿エラー。早急に対処お願いします: ${e.message}`);
        if (e.response) console.log("詳細:", JSON.stringify(e.response.data));
    }
}

main();
