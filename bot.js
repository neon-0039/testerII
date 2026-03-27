const misskey = require('misskey-js');
const axios = require('axios');

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
                visibility: 'home' // 【追加】返信もホーム公開に固定
            });
            console.log(`Replied to ${note.user.username}`);
        }

        // --- 3. 独り言の処理 ---
        console.log("投稿を生成中です...");
        try {
            const tl = await mk.request('notes/timeline', { limit: 20 });
            const tl_text = tl.map(n => n.text).filter(t => t).join("\n");
            visibility: 'home' // 【追加】返信もホーム公開に固定
            const prompt = `
            ${config.characterSetting}
            【タイムラインの内容】
            ${tl_text}
            【指示】
            タイムラインを分析し、傾向やテンションを分析してキャラ設定に従って1言投稿してください。
            - 75文字以内。見た人が不快になるような内容は避けてください。ですが多少支離滅裂になってしまっても問題ありません。特定の人の話題の時は、その人の名前を明記してください。
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
