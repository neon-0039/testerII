const misskey = require('misskey-js');
const axios = require('axios');

const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    characterSetting: "好きに回答してください"
};

// Misskey初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

// Gemini APIに直接リクエストを送る関数
async function askGemini(prompt) {
    // 【修正箇所】モデル名を gemini-1.5-flash-latest に変更し、確実に v1 で呼び出します
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${config.geminiKey}`;
    
    const payload = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    // 以前の 404 エラーを回避するため、成功するまで直接叩きます
    const response = await axios.post(url, payload);
    return response.data.candidates[0].content.parts[0].text;
}

async function main() {
    try {
        const me = await mk.request('i');
        const my_id = me.id;
        const my_username = me.username;

        // --- 1. 自動フォロバ処理 ---
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

        // --- 2. メンション取得・返信 ---
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

            const reply_prompt = `${config.characterSetting}\n相手の言葉: ${user_input}\nこれに対して75文字以内で返信してください。`;
            
            const reply_text = await askGemini(reply_prompt);
            
            await mk.request('notes/create', {
                text: reply_text.trim().slice(0, 75),
                replyId: note.id
            });
            console.log(`Replied to ${note.user.username}`);
        }

    } catch (e) {
        console.log(`リプライエラー。: ${e.message}`);
    }

    // --- 3. 独り言の処理 ---
    console.log("投稿を生成中です...");
    try {
        const tl = await mk.request('notes/timeline', { limit: 20 });
        const tl_text = tl.map(n => n.text).filter(t => t).join("\n");

        const prompt = `
        ${config.characterSetting}
        【タイムラインの内容】
        ${tl_text}
        【指示】
        タイムラインを分析し、キャラ設定に従って1言投稿してください。
        - 75文字以内。相手が不快になるような内容は避けてください。
        `;

        const post_content = await askGemini(prompt);

        await mk.request('notes/create', { text: post_content.trim().slice(0, 75) });
        console.log(`Posted: ${post_content}`);

    } catch (e) {
        console.log(`投稿エラー。早急に対処お願いします: ${e.message}`);
    }
}

main();
