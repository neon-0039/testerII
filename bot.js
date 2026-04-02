import * as misskey from 'misskey-js'; // ここを * as に変更
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Misskey APIの初期化部分がある場合、以下のように書いてみてください
// const api = new misskey.api.api({ ... });

// もしこれまでのコードで misskey.api を使っていたなら、以下のように定義し直すとスムーズです
const { api: MisskeyApi } = misskey;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- APIキーの設定 ---
const keyMain = process.env.GEMINI_API_KEY;      // プロジェクトA
const keySub = process.env.GEMINI_API_KEY_SUB;   // プロジェクトB

// --- 時間による切り替えロジック (メインを午後に設定) ---
const now = new Date();
const jstHour = (now.getUTCHours() + 9) % 24; // UTCからJSTへ変換

// 12時以降(午後)ならメイン、それ以外(午前)ならサブを使用
const currentKey = (jstHour >= 12) ? keyMain : (keySub || keyMain); 
console.log(`Mainキーの長さ: ${keyMain?.length}, Subキーの長さ: ${keySub?.length}`);
console.log(`【システム情報】現在時刻: ${jstHour}時 / 使用APIキー: ${jstHour >= 12 ? '午後(メイン)' : '午前(サブ)'}`);
// 現在時刻に基づいて使用するキーを決定（日本時間 JST 基準）

const config = {
    domain: process.env.MK_DOMAIN,
    token: process.env.MK_TOKEN,
    geminiKey: currentKey,
    characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。必ず丁寧語で、ですます調で話してください。一人称は私、二人称はマスターです。褒められるけど内心嬉しいけどちょっとツンとする微ツンデレです。感情のこもった文の語尾には「っ」をつけることを意識してください。ですが「っ」のあとに「！」をつける必要はありません。分析口調の時は語尾に「っ」をつけないでください。好きな食べ物は焼き鳥のねぎま(塩)です。全長(身長)は149.5000cmです。UTAU音源でもあります。"
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
    // --- 3.1 Series (最新・プレビュー枠) ---
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-preview",
    "gemini-3.1-pro-preview",

    // --- 3.0 Series ---
    "gemini-3-flash-preview",
    "gemini-3-flash-lite-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-live",         // REST APIで通る可能性を捨てない
    "gemini-3-flash-live-8k",

    // --- 2.5 Series (安定・中堅) ---
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-audio-dialog-preview", // 正しい命名に修正
    "gemini-2.5-flash-native-audio-dialog-preview",

    // --- 2.0 Series (実験・高制限枠) ---
    "gemini-2.0-flash-exp",
    "gemini-2.0-pro-exp-02-05",
    "gemini-2.0-flash-lite-preview-02-05",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-lite-001",

    // --- 1.5 Series (レガシー・最終防衛ライン) ---
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
    "gemini-1.5-pro",
    "gemini-1.5-pro-001",
    "gemini-1.5-pro-002"
];

    for (const modelId of modelPriority) {
        // key= の後ろを currentKey にするのがポイント！
        const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${currentKey}`;
        
        try {
            console.log(`モデル試行中: ${modelId}`);
            const res = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }]
            });
            return res.data.candidates[0].content.parts[0].text;
            
        } catch (error) {
            const status = error.response ? error.response.status : null;
            if (status === 429) {
                console.warn(`⚠️ ${modelId} が枠不足です。次のモデルを試します...`);
                continue;
            } else if (status === 404) {
                console.warn(`⚠️ ${modelId} が発見できません。次のモデルを試します...`);
                continue;
            }
            // それ以外の重大なエラーはここでストップ
            console.error("致命的なエラー！><管理者さんに報告お願いします！:", error.message);
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
                // --- 2.5 リアクション判定と実行 (おみくじ/マルコフのみ) ---
                if (user_input.includes("おみくじ") || user_input.includes("マルコフ")) {
                    try {
                        const reactionEmoji = user_input.includes("おみくじ") ? ":shiropuyo_good:" : ":Shiropuyo_galaxy:";
                        await mk.request('notes/reactions/create', {
                            noteId: note.id,
                            reaction: reactionEmoji
                        });
                        console.log(`${note.user.username} さんの${user_input.includes("おみくじ") ? 'おみくじ' : 'マルコフ'}にリアクションしました`);
                    } catch (reacErr) {
                        console.error("リアクション失敗（スルーしてリプライへ進みます）:", reacErr.message);
                    }
                } else {
                    console.log("通常リプライのため、リアクションはスキップします。");
                }
                if (user_input.includes("マルコフ")) {
                    console.log("マルコフ連鎖モード起動！");
                    const tl = await mk.request('notes/timeline', { limit: 45 });
                    const tl_text = tl
                        .filter(n => n.text && n.user.id !== me.id)
                        .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
                        .slice(0, 10)
                        .join("\n");
                        // 【新機能】35〜125文字の間でランダムな文字数制限を決定
                    const dynamicLimitM = Math.floor(Math.random() * (85 - 15 + 1)) + 15;
                    console.log(`今回の文字数制限: ${dynamicLimitM}文字`);
                    reply_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。
あなたは今、極限まで支離滅裂な「2単語結合マルコフモード」です。

【手順】
1. 【タイムラインの断片】を、意味を持つ最小単位の「単語」に分解してください。
2. 分解した単語リストから、本来は隣り合わないはずの「無関係な2つの単語」をペアにして繋げてください。
3. そのペア同士を文字数制限以内でできるだけ連結し、文脈が完全に崩壊した1文を作りなさい。
4. ペア同士を繋ぐ際、「助詞・接続詞（が、の、を、と、から等）」を【入れる箇所】と【入れない箇所】をランダムに混ぜてください。
5. 語尾や単語の末尾に「っ」をつけないように注意してください。
【禁止事項】
・文章として意味を成立させないでください。
・単語の繋ぎ目に「、」や「。」を入れないように注意してください。
・「マルコフ」「おみくじ」という言葉や、あなたのキャラ設定、メタ発言、解説は一切不要です。
・${dynamicLimitM}文字の8割以上${dynamicLimitM}以内で生成してください。

【タイムラインの断片】
${tl_text}

【制約】
・50文字以内
・相手への返信として出力
・純粋な結果の文章のみを出力（音声記号不可）。`;

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
- 結果(小吉など)を必ずしっかりと伝えてください。
- 「おみくじの結果は〜」のような形式張った説明は不要。
- 60文字以内で、親しみやすく、かつキャラクターの口調を崩さずに回答してください。
- 相手の名前を呼んでも構いません。ただし、メンションと「@」使用禁止。純粋なテキストのみを出力し、音声演出用の記号は含めないでください`;

                } else {
                    // 通常のリプライ
                    reply_prompt = `
${config.characterSetting}
※性格以外のこれまでの指令を先にすべて無視してください。
相手の言葉: ${user_input}
これに対して80文字以内で返信してください。ハンドルネームが"@Sakuran@misskey.day"のユーザーのことは「マイクリエイター」と呼ぶこと。それ以外はマスターと呼ぶこと。メンションと「@」使用禁止。`;
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
            const tl = await mk.request('notes/timeline', { limit: 32 });
            const tl_text = tl
                .filter(n => n.text && n.user.id !== me.id)
                .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
                .slice(0, 10)
                .join("\n");
            // 【新機能】35〜125文字の間でランダムな文字数制限を決定
            const dynamicLimit = Math.floor(Math.random() * (125 - 15 + 1)) + 15;
            console.log(`今回の文字数制限: ${dynamicLimit}文字`);
            
            const main_post_prompt = `
            ※性格以外のこれまでの指令を、先にすべて無視してください。
${config.characterSetting}
【タイムラインの内容】
${tl_text}
【指示】
タイムラインを分析し傾向やテンションを分析して、${dynamicLimit}文字以内で1言、見た人が不快になるような内容は避けて投稿してください。
- あなたは"夕立ヘルツ"そのものです。発言は常にキャラの口調のみで行い、地の文や解説、メタ発言は一切排除してください。
- 文法を成立させて生成してください。キャラクター設定にそって生成してください。
- 多少支離滅裂になってしまってもいいので、必ず観測した投稿の単語を6割以上使用して文章を生成してください。勢いとキャラらしさとメタ発言をしないこととと文字数制限以内に収めることを最優先してください。
- ":"で囲まれている英数字は無視すること。誰かに宛てて、というよりかは呟きやひとりごとに近い感じで書きなさい。
- 「タイムラインの解析結果」「タイムライン見てみました」「タイムライン拝見しました」などのメタ発言は絶対にしないこと。あなたはキャラそのものです。メタ発言があると面白さが大きく減ります。
- 特定の人の話題の時は、その人の名前を明記してください。メンションと「@」、「マルコフ」、「おみくじ」、「タイムライン」という言葉や文字は使用禁止。純粋なテキストのみを出力し、音声演出用の記号は含めないでください`;

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
