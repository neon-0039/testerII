const { APIClient } = require('misskey-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 環境変数の読み込み
const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    charSetting: "好きに回答してください" // Python版のCHARACTER_SETTING
};

// 初期化
const mk = new APIClient({ origin: `https://${config.domain}`, i: config.token });
const genAI = new GoogleGenerativeAI(config.geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function main() {
    try {
        // 1. 自分の情報を取得
        const me = await mk.request('i');
        const myId = me.id;
        const myUsername = me.username;

        // 2. メンション取得
        console.log("メンションを確認中...");
        let mentions = [];
        try {
            mentions = await mk.request('notes/mentions', { limit: 10 });
        } catch (e) {
            console.log(`メンション取得スキップ: ${e.message}`);
        }

        for (const note of mentions) {
            // ボットまたは自分自身は除外
            if (note.user.isBot || note.userId === myId) continue;

            let userInput = note.text || "";
            if (!userInput) continue;

            // メンション部分を除去
            userInput = userInput.replace(`@${myUsername}`, "").trim();

            const replyPrompt = `${config.charSetting}\n相手の言葉: ${userInput}\nこれに対して75文字以内で返信してください。`;

            // AI返信生成
            const result = await model.generateContent(replyPrompt);
            const response = await result.response;
            const replyText = response.text().trim().slice(0, 75);

            // Misskeyにリプライ
            await mk.request('notes/create', {
                text: replyText,
                replyId: note.id
            });
            console.log(`Replied to ${note.user.username}`);
        }

    } catch (e) {
        console.error(`リプライエラー。: ${e.message}`);
    }

    // --- 独り言の処理 ---
    console.log("投稿を生成中です...");
    try {
        // 3. タイムライン取得
        const tl = await mk.request('notes/timeline', { limit: 20 });
        const tlText = tl
            .map(n => n.text)
            .filter(t => t)
            .join("\n");

        const prompt = `
        ${config.charSetting}
        【タイムラインの内容】
        ${tlText}
        【指示】
        タイムラインを分析し、キャラ設定に従って1言投稿してください。
        - 75文字以内。相手が不快になるような内容は避けてください。
        `;

        // AI独り言生成
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const postContent = response.text().trim().slice(0, 75);

        // 4. Misskeyにホーム投稿
        await mk.request('notes/create', { text: postContent });
        console.log(`Posted: ${postContent}`);

    } catch (e) {
        console.error(`投稿エラー。早急に対処お願いします: ${e.message}`);
    }
}

// 実行
main();
