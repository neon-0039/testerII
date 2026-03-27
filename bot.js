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

/**
 * Gemini API に直接リクエストを送る関数
 */
async function askGemini(prompt) {
    // 【解呪の決定版】
    // 1. バージョンを v1 に固定
    // 2. モデル名を 'models/' から始まるフルパスで指定
    // この組み合わせが、現在最も「404」が出にくい公式推奨の形です
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${config.geminiKey}`;
    
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
        console.log("メンションを確認中...");
        let mentions = [];
        try {
            mentions = await mk.request('notes/mentions', { limit: 10 });
        } catch (e) {
            mentions = [];
        }

        for (const note of mentions) {
            if (note.user.isBot || note.user.id === my_id) continue;

            let user_input = (note.text || "").replace(`@${my_username}`, "").trim();
            if (!user_input) continue;

            const reply_prompt = `${config.characterSetting}\n相手の言葉: ${user_input}\nこれに対して75文字以内で返信してください。`;
            const reply_text = await askGemini(reply_prompt);
            
            await mk.request('notes/create', {
                text: reply_text.trim().slice(0, 75),
                replyId: note.id
            });
            console.log(`Replied to ${note.user.username}`);
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
            - 75文字以内。不快な内容は避けてください。
            `;

            const post_content = await askGemini(prompt);

            await mk.request('notes/create', { text: post_content.trim().slice(0, 75) });
            console.log(`Posted: ${post_content}`);

        } catch (e) {
            console.log(`投稿生成エラー: ${e.message}`);
        }

    } catch (e) {
        console.log(`全体エラー: ${e.message}`);
    }
}

main();
