const misskey = require('misskey-js');
const axios = require('axios');

async function main() {
    const key = process.env.GEMINI_API_KEY;
    // 【解呪のための調査】今使えるモデルをリストアップします
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        console.log("利用可能なモデルを調査中...");
        const res = await axios.get(url);
        const models = res.data.models.map(m => m.name);
        console.log("--- あなたのキーで使えるモデル一覧 ---");
        console.log(models.join("\n"));
        console.log("------------------------------------");
        
        console.log("\nこのリストの中に 'models/gemini-1.5-flash' はありますか？");
        console.log("もし別の名前（例: models/gemini-1.5-flash-8b など）があれば、次からはそれを使います。");
    } catch (e) {
        console.log("調査自体が失敗しました。キーが正しく設定されていない可能性があります。");
        if (e.response) console.log(JSON.stringify(e.response.data));
    }
}

main();
