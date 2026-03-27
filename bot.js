const misskey = require('misskey-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 環境変数
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    characterSetting: "好きに回答してください"
};

// 1. Misskeyクライアント初期化
const mk = new misskey.api.APIClient({
    origin: `https://${config.domain}`,
    credential: config.token
});

// 2. Gemini初期化
const genAI = new GoogleGenerativeAI(config.geminiKey);

// 【最重要】404エラーを物理的に回避する設定
// apiVersionを'v1'に固定し、model名から余計な文字を排除します
const model = genAI.getGenerativeModel(
    { model: "gemini-1.5-flash" }, 
    { apiVersion: 'v1' }
);

async function main() {
    try {
        const me = await mk.request('i');
        const my_id = me.id;
        const my_username = me.username;
        console.log(`Logged in as: @${my_username}`);

        // --- 自動フォロバ処理 ---
        console.log("未フォローのフォロワーを確認中...");
        try {
            const followers = await mk.request('users/followers', { userId: my_id, limit: 20 });
            for (const f of followers) {
                const target = f.follower;
                // まだフォローしておらず、Botでもないユーザーをフォロバ
                if (target && !target.isFollowing && !target.isBot && target.id !== my_id) {
                    await mk.request('following/create', { userId: target.id })
                        .then(() => console.log(`Followed back: ${target.username}`))
                        .catch(() => {});
                }
            }
        } catch (e) {
            console.log("フォロバ処理でエラー（スキップします）");
        }

        // --- メンション返信 ---
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
            
            const result = await model.generateContent(reply_prompt);
            const response = await result.response;
            const reply_text = response.text().trim().slice(0, 75);

            await mk.request('notes/create', {
                text: reply_text,
                replyId: note.id
            });
            console.log(`Replied to ${note.user.username}`);
        }

        // --- 独り言の処理 ---
        console.log("投稿を生成中です...");
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

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const post_content = response.text().trim().slice(0, 75);

        await mk.request('notes/create', { text: post_content });
        console.log(`Posted: ${post_content}`);

    } catch (e) {
        console.log(`エラーが発生しました: ${e.message}`);
    }
}

main();
