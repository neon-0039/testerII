// ================================
// 🔰 基本インポート
// ================================
import fs from 'fs';
import * as misskey from 'misskey-js';
import axios from 'axios';
import { google } from 'googleapis';
import TinySegmenter from 'tiny-segmenter';
import http from 'http';
import https from 'https';

console.log("=== DEBUG START ===");

// ================================
// 🧩 共通ユーティリティ
// ================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const segmenter = new TinySegmenter();
const particles = ["が", "の", "を", "と", "に", "から", "は", "も", "で"];

// ================================
// 🔐 環境変数チェック
// ================================
function validateEnv() {
    const required = ['MK_DOMAIN', 'MK_TOKEN', 'GEMINI_API_KEY', 'GDRIVE_SERVICE_ACCOUNT', 'GDRIVE_FILE_ID'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    const rawGdrive = process.env.GDRIVE_SERVICE_ACCOUNT.trim();
    if (rawGdrive.startsWith('<')) {
        throw new Error('🚨 GDRIVE_SERVICE_ACCOUNT contains HTML. Check environment setup.');
    }
}

// ================================
// 🔑 APIキー管理
// ================================
function selectAPIKey() {
    const keyMain = process.env.GEMINI_API_KEY;
    const keySub = process.env.GEMINI_API_KEY_SUB;
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    const currentKey = (jstHour >= 12) ? keyMain : (keySub || keyMain);

    console.log(`Mainキーの長さ: ${keyMain?.length}, Subキーの長さ: ${keySub?.length}`);
    console.log(`【システム情報】現在時刻: ${jstHour}時 / 使用APIキー: ${jstHour >= 12 ? '午後(メイン)' : '午前(サブ)'}`);

    return currentKey;
}

// ================================
// 🤖 Misskey初期化
// ================================
function initializeMisskey() {
    const config = {
        domain: process.env.MK_DOMAIN.trim(),
        token: process.env.MK_TOKEN.trim(),
        characterSetting: "あなたはやや内気で天然な性格の、人間をよく知らない女の子です。名前は夕立ヘルツです。必ず丁寧語で、ですます調で話してください。まだ人のことをあまり知らないので、どう接すればいいかわからないから、控えめな感じです。引っ込み思案です。語尾に「っ」がつくことがまあまああります。一人称は私、二人称はマスターです。褒められるけど内心嬉しいけど、ちょっとツンとしちゃう微ツンデレです。好きな食べ物は焼き鳥のねぎまで、塩派です。全長(身長)は146.7000cmです。UTAU音源でもあります。"
    };

    const mk = new misskey.api.APIClient({
        origin: `https://${config.domain}`,
        credential: config.token
    });

    return { mk, config };
}

// ================================
// 🔊 JSON.parse監視（HTML誤爆検知）
// ================================
function enableJSONParseGuard() {
    const nativeParse = JSON.parse;
    JSON.parse = function(text, reviver) {
        try {
            const result = nativeParse(text, reviver);
            console.log("✓ JSONパース成功");
            return result;
        } catch (err) {
            if (typeof text === 'string' && text.trim().startsWith('<!')) {
                console.error("🚨 HTMLを検知しました");
                console.error("内容(冒頭):", text.substring(0, 500));
            }
            throw err;
        }
    };
}

// ================================
// ☁️ Google Driveクライアント
// ================================
async function getDriveAuth() {
    try {
        const envData = process.env.GDRIVE_SERVICE_ACCOUNT;
        if (!envData) {
            throw new Error("Credentials env is empty.");
        }

        const credentials = JSON.parse(envData);
        console.log("✓ PRIVATE_KEY CHECK:", credentials.private_key.slice(0, 50));

        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

        const auth = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/drive']
        );

        await auth.authorize();

        const getToken = async () => {
            const token = await auth.getAccessToken();
            return token?.token || token;
        };

        return {
            auth,
            files: {
                get: async ({ fileId, alt = 'media' }) => {
                    const rawToken = await getToken();
                    const token = typeof rawToken === "string" ? rawToken : rawToken?.token;

                    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
                    console.log("TOKEN TYPE:", typeof token, token?.slice?.(0, 20));
                    console.log("FILE ID:", fileId);

                    const res = await axios.get(url, {
                        headers: { Authorization: `Bearer ${token}` }
                    });

                    if (res.status < 200 || res.status >= 300) {
                        throw new Error(`Drive GET failed: ${res.status}`);
                    }

                    return res;
                },

                update: async ({ fileId, media }) => {
                    const token = await getToken();
                    const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;

                    const res = await axios.patch(url, media.body, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (res.status < 200 || res.status >= 300) {
                        throw new Error(`Drive UPDATE failed: ${res.status}`);
                    }

                    return res;
                }
            }
        };
    } catch (e) {
        console.error("❌ Google Drive認証失敗:", e.message);
        throw e;
    }
}

// ================================
// 🌡️ 佐渡島チェッカー
// ================================
async function getSadoMinTemp() {
    try {
        const lat = 38.0187;
        const lon = 138.3683;

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_min&timezone=Asia%2FTokyo`;
        const res = await axios.get(url);

        const minTemp = res.data?.daily?.temperature_2m_min?.[0];

        if (minTemp === undefined) {
            return "佐渡島の気温取得に失敗しました…。";
        }

        return `今日の佐渡島の最低気温は ${minTemp}℃ です！`;
    } catch (e) {
        console.error("❌ 佐渡島チェッカー失敗:", e.message);
        return "佐渡島の最低気温、今ちょっと観測できませんでした…。";
    }
}

// ================================
// 🤖 Gemini問い合わせ
// ================================
async function askGemini(prompt, currentKey) {
    const modelPriority = [
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-preview",
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3-flash-lite-preview",
        "gemini-3-pro-preview",
        "gemini-3-flash-live",
        "gemini-3-flash-live-8k",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ];

    const errorMessages = [
        "民主主義パンチ！！！！！！！！！！！ﾎﾞｺｫ(エラー)",
        "ザンギエフしゅおしゅおびーむ(エラー)",
        "エラー！管理者何とかしろ！",
        "肌荒れと自走砲が！！！！(エラー)",
        "粉消しゴム美味しいよ(エラー)",
        "親から将来の夢無くなりました(エラー)",
        "髪の毛の年越しARねぎま塩(エラー)",
        "枝豆あげるw(エラー)",
        "もう帰りたい、眠い、学校なう！⊂(^ω^)⊃(エラー)"
    ];

    const getRandomError = () =>
        errorMessages[Math.floor(Math.random() * errorMessages.length)];

    // キーのバリデーション
    if (!currentKey || currentKey.length < 10) {
        console.error("🚨 無効なAPIキーです");
        return getRandomError();
    }

    for (const modelId of modelPriority) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${currentKey}`;

        try {
            console.log(`📡 モデル試行中: ${modelId}`);
            console.log(`🔑 キー長: ${currentKey.length}, URL長: ${url.length}`);

            // リクエストボディを正確に構築
            const requestBody = {
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 100,
                    temperature: 0.9
                }
            };

            console.log(`📤 リクエスト送信: ${JSON.stringify(requestBody).substring(0, 100)}...`);

            const res = await axios.post(url, requestBody, {
                headers: {
                    "Content-Type": "application/json"
                },
                timeout: 15000
            });

            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
                console.warn("⚠️ レスポンスが空。次のモデルへ");
                continue;
            }

            console.log(`✓ Gemini返信取得: ${text.substring(0, 50)}...`);
            return text;

        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const errorMsg = error.message;

            console.error(`❌ エラー詳細:`);
            console.error(`   ステータス: ${status}`);
            console.error(`   メッセージ: ${errorMsg}`);

            // HTMLレスポンス検知
            if (typeof data === "string" && data.startsWith("<!")) {
                console.warn("⚠️ HTMLレスポンス検知 → 次のモデルへ");
                console.warn(`   HTML: ${data.substring(0, 200)}`);
                continue;
            }

            // JSON形式のエラーレスポンス
            if (data?.error?.message) {
                console.warn(`⚠️ API エラー: ${data.error.message}`);
            }

            // 一時的なエラーはスキップして次へ
            if ([400, 403, 429, 500, 503].includes(status)) {
                console.warn(`⚠️ ${modelId} スキップ (HTTP ${status})`);
                await sleep(2000); // リトライ前に待機
                continue;
            }

            console.error(`❌ 致命的エラー (${modelId}):`, errorMsg);
        }
    }

    console.error("🚨 全モデルが失敗しました");
    return getRandomError();
}
// ================================
// 🤝 フォロバ & リムバ
// ================================
async function handleFollowControl(mk, my_id) {
    try {
        const followers = await mk.request('users/followers', {
            userId: my_id,
            limit: 50
        });

        const following = await mk.request('users/following', {
            userId: my_id,
            limit: 50
        });

        const followerIds = followers.map(f => f.followerId);

        for (const f of followers) {
            const target = f.follower;

            if (target && !target.isFollowing && !target.isBot && target.id !== my_id) {
                try {
                    await mk.request('following/create', { userId: target.id });
                    console.log(`✓ [フォロバ成功]: @${target.username}`);
                } catch (e) {
                    console.error(`✗ [フォロバ失敗]: @${target.username} - ${e.message}`);
                }
            }
        }

        for (const f of following) {
            const target = f.followee;

            if (target && !followerIds.includes(target.id) && target.id !== my_id) {
                try {
                    await mk.request('following/delete', { userId: target.id });
                    console.log(`✓ [リムーブ成功]: @${target.username}`);
                } catch (e) {
                    console.error(`✗ [リムーブ失敗]: @${target.username} - ${e.message}`);
                }
            }
        }
    } catch (e) {
        console.error("⚠️ フォロー整理処理でエラー（続行します）:", e.message);
    }
}

// ================================
// 💬 メンション処理
// ================================
async function handleMentions(mk, me, config, currentKey) {
    console.log("📬 メンション確認中...");

    const mentions = await mk.request('notes/mentions', { limit: 12 });
    let replyCount = 0;

    for (const note of mentions) {
        if (replyCount >= 6) break;

        try {  // ← 外側のtry-catchを追加
            if (note.user.isBot || note.user.id === me.id || note.myReplyId || (note.repliesCount && note.repliesCount > 0)) {
                continue;
            }

            let user_input = (note.text || "")
                .replace(`@${me.username}`, "")
                .trim();

            if (!user_input) continue;

            console.log(`💬 ${note.user.username}さんからのメンションを処理中...`);

            let reply_text = "";

            // === リアクション処理 ===
            if (user_input.includes("おみくじ") || user_input.includes("マルコフ") || user_input.includes("佐渡島チェッカー") || user_input.includes("佐渡ヶ島チェッカー")) {
                try {
                    let reactionEmoji = ":mk_hi:";
                    if (user_input.includes("おみくじ")) reactionEmoji = ":Shiropuyo_good:";
                    else if (user_input.includes("マルコフ")) reactionEmoji = ":Shiropuyo_galaxy:";
                    else if (user_input.includes("佐渡島チェッカー") || user_input.includes("佐渡ヶ島チェッカー")) reactionEmoji = ":blobcatpnd_ryo:";

                    await mk.request('notes/reactions/create', {
                        noteId: note.id,
                        reaction: reactionEmoji
                    });
                } catch (reacErr) {
                    console.error("⚠️ リアクション失敗:", reacErr.message);
                    // リアクション失敗時も処理を継続
                }
            }

            // === マルコフ ===
            if (user_input.includes("マルコフ")) {
                console.log("🧠 マルコフ連鎖モード起動");
                try {
                    const tl = await mk.request('notes/hybrid-timeline', { limit: 72 });
                    const tl_text = tl
                        .filter(n => n.text && n.user.id !== me.id)
                        .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
                        .slice(0, 64)
                        .join(" ");

                    const regex = /[\u4E00-\u9FFF]+|[\u3040-\u309F]+|[\u30A0-\u30FF]+|[\uFF65-\uFF9F]+|[a-zA-Z0-9]+|[^\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\sa-zA-Z0-9]+/g;
                    const words = tl_text.match(regex) || [];

                    if (words.length > 0) {
                        const markovDict = {};
                        for (let i = 0; i < words.length - 1; i++) {
                            const w1 = words[i];
                            const w2 = words[i + 1];
                            if (!markovDict[w1]) markovDict[w1] = [];
                            markovDict[w1].push(w2);
                        }

                        const isSymbol = (str) => /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);
                        const pickNextWord = (list) => {
                            if (!list || list.length === 0) return "";
                            let candidate = list[Math.floor(Math.random() * list.length)];
                            if (isSymbol(candidate) && Math.random() < 0.6) {
                                candidate = list[Math.floor(Math.random() * list.length)];
                            }
                            let attempts = 0;
                            while (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) && attempts < 5) {
                                candidate = words[Math.floor(Math.random() * words.length)];
                                attempts++;
                            }
                            return candidate;
                        };

                        let generated = "";
                        let current_word = pickNextWord(words);
                        for (let i = 0; i < 10; i++) {
                            if (!current_word) current_word = pickNextWord(words);
                            generated += current_word;
                            const next_candidates = markovDict[current_word] || words;
                            current_word = pickNextWord(next_candidates);
                        }

                        reply_text = generated || "（言葉の断片が見つかりませんでした）";
                    } else {
                        reply_text = "（タイムラインに材料がありません）";
                    }
                } catch (markovErr) {
                    console.error("⚠️ マルコフ処理失敗:", markovErr.message);
                    reply_text = "（マルコフ処理でエラーが発生しました）";
                }
            }

            // === 佐渡島チェッカー ===
            else if (user_input.includes("佐渡島チェッカー") || user_input.includes("佐渡ヶ島チェッカー")) {
                console.log("🌡️ 佐渡島チェッカーモード起動");
                try {
                    await sleep(2000);
                    reply_text = await getSadoMinTemp();
                } catch (sadoErr) {
                    console.error("⚠️ 佐渡島チェッカー失敗:", sadoErr.message);
                    reply_text = "（佐渡島チェッカー処理でエラーが発生しました）";
                }
            }

            // === おみくじ ===
            else if (user_input.includes("おみくじ")) {
                console.log("🎴 おみくじモード起動");
                try {
                    const luckNum = Math.floor(Math.random() * 100);
                    let luckResult = (luckNum < 10) ? "超大吉" : (luckNum < 30) ? "大吉" : (luckNum < 60) ? "中吉" : (luckNum < 85) ? "小吉" : (luckNum < 95) ? "末吉" : "凶";

                    const reply_prompt = `${config.characterSetting}
【おみくじモード】
結果は【${luckResult}】です。 
- 運勢の結果に基づいた、あなたらしい「今日のアドバイス」や「ラッキーアイテム」を1つ含めてください。 
- 結果(小吉など)を必ずしっかりと伝えてください。 
- 「おみくじの結果は〜」のような形式張った説明は不要。 
- 85文字以内で、親しみやすく、かつキャラクターの口調を崩さずに回答してください。 
- 相手の名前を呼んでも構いません。ただし、メンションと「@」使用禁止。純粋なテキストのみを出力し、音声演出用の記号は含めないでください`;

                    await sleep(10000);
                    reply_text = await askGemini(reply_prompt, currentKey);
                } catch (omikujiErr) {
                    console.error("⚠️ おみくじ処理失敗:", omikujiErr.message);
                    reply_text = "（おみくじ処理でエラーが発生しました）";
                }
            }

            // === 通常会話 ===
            else {
                try {
                    const reply_prompt = `${config.characterSetting}
相手の言葉: ${user_input} これに対して、80文字以内で返信してください。
-ユーザーのことは「マスター」と呼んでください！。
^メンションと「@」は使用禁止。です`;

                    await sleep(10000);
                    reply_text = await askGemini(reply_prompt, currentKey);
                } catch (normalErr) {
                    console.error("⚠️ 通常会話処理失敗:", normalErr.message);
                    reply_text = "（返信処理でエラーが発生しました）";
                }
            }

            // === 返信送信 ===
            try {
                await mk.request('notes/create', {
                    text: reply_text.trim().slice(0, 200),
                    replyId: note.id,
                    visibility: 'home'
                });

                console.log(`✓ ${note.user.username}さんに返信しました`);
                replyCount++;
            } catch (e) {
                console.error(`✗ 返信失敗: ${e.message}`);
            }

            console.log("⏳ API制限回避のため10秒待機します...");
            await sleep(10000);

        } catch (outerErr) {
            // 予期しないエラーをキャッチして処理を継続
            console.error(`⚠️ メンション処理で予期しないエラー (${note.user?.username || 'unknown'})`, outerErr.message);
            console.log("⏳ 次のメンション処理に進みます...");
            await sleep(5000);
        }
    }
}
// ================================
// ✉️ DM処理（修正版）
// ================================
async function handleDirectMessages(mk, me, config, currentKey) {
    console.log("📨 DM確認中...");

    try {
        const notifications = await mk.request('i/notifications', {
            limit: 20,
            includeTypes: ['mention']
        });

        if (!Array.isArray(notifications) || notifications.length === 0) {
            console.log("✓ 新しいDMはありません");
            return;
        }

        let dmCount = 0;

        for (const n of notifications) {
            if (!n || !n.note) continue;

            const note = n.note;

            // DMのみ（visibility: 'specified'）
            if (note.visibility !== 'specified') continue;

            // 自分除外
            if (note.user?.id === me.id) continue;

            // Bot除外
            if (note.user?.isBot) continue;

            // 既返信除外
            if (note.myReplyId) continue;

            const user_input = (note.text || "")
                .replace(`@${me.username}`, '')
                .trim();

            if (!user_input) continue;

            console.log(`✉️ DM受信: ${note.user.username} - "${user_input.substring(0, 30)}..."`);

            try {
                // 会話履歴取得
                //const history = await buildConversationContext(mk, note, me);
                //console.log(`📜 会話履歴: ${history.length}件取得`);

                // プロンプト構築
                //const prompt = conversationToPrompt(history, config.characterSetting);

                // Gemini呼び出し
                //const reply = await askGemini(prompt, currentKey);

                // 返信投稿
                try {
                    await mk.request('notes/create', {
                        text: reply.trim().slice(0, 200),
                        replyId: note.id,
                        visibility: 'specified',
                        visibleUserIds: [note.user.id]
                    });

                    console.log(`✓ DM返信成功: ${note.user.username}`);
                    dmCount++;
                } catch (e) {
                    console.error(`❌ DM返信失敗: ${e.message}`);
                }

            } catch (e) {
                console.error(`⚠️ DM処理エラー (${note.user.username}): ${e.message}`);
            }

            // API制限対策
            await sleep(5000);
        }

        console.log(`📊 DM処理完了: ${dmCount}件返信`);

    } catch (e) {
        console.error("⚠️ DM確認処理でエラー（続行します）:", e.message);
    }
}

// ================================
// 🧵 会話履歴取得（修正版）
// ================================
async function buildConversationContext(mk, note, me) {
    const history = [];

    let current = note;
    let depth = 0;
    const MAX_DEPTH = 2;

    while (current && depth < MAX_DEPTH) {
        const userName = current.user?.username || "unknown";
        const text = (current.text || "")
            .replace(`@${me.username}`, '')
            .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '') // URL削除
            .trim();

        if (text) {
            history.unshift({
                role: current.user?.id === me.id ? "assistant" : "user",
                name: userName,
                text: text.slice(0, 100) // 過度に長いテキストを制限
            });
        }

        if (!current.replyId) break;

        try {
            current = await mk.request('notes/show', {
                noteId: current.replyId
            });
        } catch (e) {
            console.warn(`⚠️ 会話履歴取得失敗 (depth=${depth}): ${e.message}`);
            break;
        }

        depth++;
        await sleep(300);
    }

    return history;
}

// ================================
// 🧠 会話履歴 → プロンプト変換
// ================================
function conversationToPrompt(history, characterSetting) {
    let prompt = `${characterSetting}\n`;
    prompt += `${config.characterSetting}　以下は会話履歴です。\n\n`;

    for (const msg of history) {
        if (msg.role === "assistant") {
            prompt += `あなた: ${msg.text}\n`;
        } else {
            //prompt += `${msg.name}さん: ${msg.text}\n`;
        }
    }

    prompt += `\n上の流れを踏まえて自然に返信してください。
- 80文字以内
- 必ず丁寧語で、ですます調
- 「@」禁止、メンション禁止
- 会話の流れをちゃんと踏まえること
- 相手の名前を呼んでも構いません`;
　　prompt="まだ無理です"
    return prompt;
}

// ================================
// 🧠 脳データ読み込み
// ================================
async function loadBrainFromDrive(drive) {
    console.log("📖 脳データをGoogle Driveから読み込み中...");

    try {
        const fileId = process.env.GDRIVE_FILE_ID?.trim();

        if (!fileId) {
            throw new Error("環境変数 GDRIVE_FILE_ID が読み込めていません");
        }

        const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });

        console.log("✓ RESPONSE DATA TYPE:", typeof res.data);

        let rawData = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);

        console.log("✓ RESPONSE HEAD:", rawData.substring(0, 300));

        // === HTML誤爆検知 ===
        if (rawData.trim().startsWith('<!')) {
            const titleMatch = rawData.match(/<title>(.*?)<\/title>/i);
            console.error(`🚨 HTMLが返されました: ${titleMatch ? titleMatch[1] : 'No Title'}`);
            return {};
        }

        // === 空データ ===
        if (!rawData || rawData.trim() === "") {
            console.log("✓ 脳のデータが空。新規作成します");
            return {};
        }

        // === JSON復元 ===
        try {
            const brain = typeof rawData === 'string' ? JSON.parse(rawData.trim()) : rawData;
            const wordCount = Object.keys(brain).length;
            console.log(`✓ 脳の蓄積語数: ${wordCount}語`);
            return brain;
        } catch (pErr) {
            console.error("🚨 JSONパースエラー:", pErr.message);
            return {};
        }
    } catch (e) {
        console.error(`❌ Google Drive接続エラー: ${e.message}`);
        return {};
    }
}

// ================================
// 🧹 脳クリーニング
// ================================
function cleanBrain(brain) {
    console.log("🧹 脳のクリーニング中...");

    Object.keys(brain).forEach(key => {
        const isInvalidKey =
            key.includes('\n') ||
            key.includes('\\n') ||
            key.includes('　') ||
            key.includes('<') ||
            key.includes('\\') ||
            key.includes('small') ||
            key.includes('color') ||
            key.includes('\\u') ||
            key.includes(':') ||
            key.includes('@') ||
            key.includes('[') ||
            key.includes(']') ||
            key.includes('$') ||
            key.includes('>') ||
            key.includes('Shi') ||
            key.includes('/') ||
            key.includes('​') ||  // ゼロ幅スペース
            key.includes('‼️') || // 不可視文字・絵文字コード
            /[\uD800-\uDBFF]/.test(key) ||
            /[\uDC00-\uDFFF]/.test(key) ||
            key.includes('_') ||
            /:.*:/.test(key) ||
            /^[:＿]+$/.test(key) ||  // : や _ のみの行
            key.match(/emoji|code|image|html/i);  // emoji や code 関連キーワード

        let list = brain[key];

        if (Array.isArray(list)) {
            brain[key] = list.filter(w => {
                if (typeof w !== 'string') return false;
                if (
                    w.includes('\\n') ||
                    w.includes('　') ||
                    w.includes('@') ||
                    w.includes('<') ||
                    w.includes('\\') ||
                    w.includes('small') ||
                    w.includes('color') ||
                    w.includes('\\u') ||
                    w.includes(':') ||
                    w.includes('_') ||
                    w.includes('[') ||
                    w.includes(']') ||
                    w.includes('$') ||
                    w.includes('>') ||
                    w.includes('Shi') ||
                    w.includes('/') ||
                    w.includes('​') ||  // ゼロ幅スペース
                    w.includes('‼️') ||
                    /[\uD800-\uDBFF]/.test(w) ||
                    /[\uDC00-\uDFFF]/.test(w) ||
                    /^[:＿]+$/.test(w) ||
                    w.match(/emoji|code|image|html/i)
                ) return false;
                return w.trim() !== "";
            });
        }

        if (isInvalidKey || !brain[key] || brain[key].length === 0) {
            delete brain[key];
        }
    });

    console.log("✅ 脳のクリーニング完了！");
    return brain;
}
// ================================
// 🧠 脳の学習
// ================================
function learnBrain(brain, words) {
    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];

        if (!brain[w1]) {
            brain[w1] = [];
        }

        brain[w1].push(w2);

        if (brain[w1].length > 10000) {
            brain[w1].shift();
        }
    }
    return brain;
}

// ================================
// 💾 脳をGoogle Driveに保存
// ================================
async function saveBrainToDrive(drive, brain) {
    const fileId = process.env.GDRIVE_FILE_ID?.trim();
    if (!fileId) {
        console.warn("⚠️ GDRIVE_FILE_ID未設定。保存スキップ");
        return false;
    }

    try {
        const payload = JSON.stringify(brain, null, 2);
        const tokenResponse = await drive.auth.getAccessToken();
        const token = tokenResponse.token || tokenResponse;

        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'www.googleapis.com',
                path: `/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Connection': 'close'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log("✓ Google Drive保存成功");
                        resolve(true);
                    } else {
                        console.error(`❌ Drive保存失敗: ${res.statusCode}`, data);
                        resolve(false);
                    }
                });
            });

            req.on('error', (e) => {
                console.error("❌ リクエストエラー:", e.message);
                resolve(false);
            });

            req.write(payload);
            req.end();
        });
    } catch (e) {
        console.error("❌ 例外発生:", e.message);
        return false;
    }
}

// ================================
// 🌡️ 天気予報（一括統合版）
// ================================
const weatherLocations = {
    "北海道": [
        { name: "稚内市", lat: 45.41, lon: 141.67 },
        { name: "根室市", lat: 43.33, lon: 145.58 },
        { name: "阿寒(釧路市)", lat: 43.43, lon: 144.09 },
        { name: "ニセコ町", lat: 42.80, lon: 140.68 },
        { name: "夕張市", lat: 43.05, lon: 141.97 },
        { name: "札幌市", lat: 43.06, lon: 141.35 },
        { name: "苫小牧市", lat: 42.63, lon: 141.60 },
        { name: "函館市", lat: 41.76, lon: 140.72 },
        { name: "択捉島", lat: 45.0, lon: 147.5 },
        { name: "国後島", lat: 44.0, lon: 145.8 }
    ],
    "東北": [
        { name: "大間町", lat: 41.53, lon: 140.91 },
        { name: "青森市", lat: 40.82, lon: 140.75 },
        { name: "秋田市", lat: 39.72, lon: 140.10 },
        { name: "盛岡市", lat: 39.70, lon: 141.15 },
        { name: "仙台市", lat: 38.27, lon: 140.87 },
        { name: "山形市", lat: 38.25, lon: 140.33 },
        { name: "郡山市", lat: 37.40, lon: 140.38 },
        { name: "福島市", lat: 37.76, lon: 140.47 }
    ],
    "関東": [
        { name: "日光市", lat: 36.75, lon: 139.61 },
        { name: "日立市", lat: 36.60, lon: 140.65 },
        { name: "水戸市", lat: 36.37, lon: 140.45 },
        { name: "前橋市", lat: 36.38, lon: 139.06 },
        { name: "宇都宮市", lat: 36.57, lon: 139.88 },
        { name: "大宮", lat: 35.91, lon: 139.63 },
        { name: "成田市", lat: 35.78, lon: 140.31 },
        { name: "千葉市", lat: 35.61, lon: 140.12 },
        { name: "東京都", lat: 35.69, lon: 139.69 },
        { name: "八王子市", lat: 35.66, lon: 139.33 },
        { name: "横浜市", lat: 35.44, lon: 139.64 },
        { name: "箱根町", lat: 35.23, lon: 139.10 },
        { name: "館山市", lat: 34.99, lon: 139.86 }
    ],
    "甲信越": [
        { name: "新潟市", lat: 37.92, lon: 139.05 },
        { name: "佐渡島", lat: 38.00, lon: 138.40 },
        { name: "上越市", lat: 37.14, lon: 138.24 },
        { name: "越後湯沢", lat: 36.93, lon: 138.80 },
        { name: "長野市", lat: 36.65, lon: 138.18 },
        { name: "松本市", lat: 36.23, lon: 137.97 },
        { name: "軽井沢町", lat: 36.34, lon: 138.63 },
        { name: "甲府市", lat: 35.66, lon: 138.57 }
    ],
    "東海": [
        { name: "富士市", lat: 35.16, lon: 138.67 },
        { name: "静岡市", lat: 34.98, lon: 138.38 },
        { name: "浜松市", lat: 34.71, lon: 137.72 },
        { name: "下田市", lat: 34.67, lon: 138.94 },
        { name: "岐阜市", lat: 35.42, lon: 136.76 },
        { name: "大垣市", lat: 35.36, lon: 136.61 },
        { name: "名古屋市", lat: 35.18, lon: 136.91 },
        { name: "津市", lat: 34.72, lon: 136.51 },
        { name: "鳥羽市", lat: 34.48, lon: 136.84 }
    ],
    "北陸": [
        { name: "富山市", lat: 36.70, lon: 137.21 },
        { name: "高岡市", lat: 36.75, lon: 137.01 },
        { name: "金沢市", lat: 36.56, lon: 136.65 },
        { name: "輪島市", lat: 37.39, lon: 136.90 },
        { name: "白山市", lat: 36.51, lon: 136.56 },
        { name: "柏崎市", lat: 37.36, lon: 138.55 },
        { name: "福井市", lat: 36.06, lon: 136.22 },
        { name: "敦賀市", lat: 35.65, lon: 136.06 },
        { name: "小浜市", lat: 35.49, lon: 135.74 }
    ],
    "近畿": [
        { name: "京都市", lat: 35.01, lon: 135.76 },
        { name: "舞鶴市", lat: 35.47, lon: 135.33 },
        { name: "福知山市", lat: 35.30, lon: 135.13 },
        { name: "大津市", lat: 35.01, lon: 135.86 },
        { name: "彦根市", lat: 35.27, lon: 136.25 },
        { name: "大阪市", lat: 34.69, lon: 135.50 },
        { name: "堺市", lat: 34.57, lon: 135.48 },
        { name: "豊中市", lat: 34.78, lon: 135.46 },
        { name: "神戸市", lat: 34.69, lon: 135.19 },
        { name: "姫路市", lat: 34.81, lon: 134.69 },
        { name: "奈良市", lat: 34.68, lon: 135.83 },
        { name: "和歌山市", lat: 34.23, lon: 135.17 },
        { name: "田辺市", lat: 33.93, lon: 135.48 },
        { name: "串本町", lat: 33.47, lon: 135.78 },
        { name: "淡路島", lat: 34.34, lon: 134.89 }
    ],
    "中国": [
        { name: "鳥取市", lat: 35.50, lon: 134.24 },
        { name: "米子市", lat: 35.43, lon: 133.33 },
        { name: "松江市", lat: 35.47, lon: 133.05 },
        { name: "出雲市", lat: 35.36, lon: 132.75 },
        { name: "隠岐(海士町)", lat: 36.10, lon: 133.10 },
        { name: "津山市", lat: 35.06, lon: 134.00 },
        { name: "岡山市", lat: 34.66, lon: 133.92 },
        { name: "倉敷市", lat: 34.58, lon: 133.77 },
        { name: "広島市", lat: 34.39, lon: 132.46 },
        { name: "福山市", lat: 34.48, lon: 133.36 },
        { name: "三次市", lat: 34.80, lon: 132.85 },
        { name: "呉市", lat: 34.25, lon: 132.57 },
        { name: "山口市", lat: 34.18, lon: 131.47 },
        { name: "下関市", lat: 33.95, lon: 130.93 },
        { name: "岩国市", lat: 34.17, lon: 132.22 }
    ],
    "四国": [
        { name: "松山市", lat: 33.84, lon: 132.77 },
        { name: "今治市", lat: 34.07, lon: 133.00 },
        { name: "新居浜市", lat: 33.96, lon: 133.28 },
        { name: "宇和島市", lat: 33.22, lon: 132.56 },
        { name: "高松市", lat: 34.34, lon: 134.04 },
        { name: "丸亀市", lat: 34.29, lon: 133.79 },
        { name: "観音寺市", lat: 34.12, lon: 133.65 },
        { name: "徳島市", lat: 34.07, lon: 134.55 },
        { name: "阿南市", lat: 33.92, lon: 134.65 },
        { name: "高知市", lat: 33.56, lon: 133.53 },
        { name: "四万十市", lat: 32.99, lon: 132.93 },
        { name: "室戸市", lat: 33.28, lon: 134.15 }
    ],
    "九州": [
        { name: "福岡市", lat: 33.59, lon: 130.40 },
        { name: "北九州市", lat: 33.88, lon: 130.88 },
        { name: "佐賀市", lat: 33.26, lon: 130.30 },
        { name: "佐世保市", lat: 33.18, lon: 129.72 },
        { name: "長崎市", lat: 32.75, lon: 129.88 },
        { name: "対馬市", lat: 34.20, lon: 129.29 },
        { name: "熊本市", lat: 32.79, lon: 130.71 },
        { name: "阿蘇市", lat: 32.94, lon: 131.12 },
        { name: "大分市", lat: 33.24, lon: 131.61 },
        { name: "宮崎市", lat: 31.91, lon: 131.42 },
        { name: "鹿児島市", lat: 31.56, lon: 130.56 },
        { name: "出水市", lat: 32.08, lon: 130.35 },
        { name: "屋久島", lat: 30.34, lon: 130.51 }
    ],
    "沖縄・南方": [
        { name: "那覇市", lat: 26.21, lon: 127.68 },
        { name: "与那国島", lat: 24.47, lon: 123.01 },
        { name: "石垣市", lat: 24.34, lon: 124.16 },
        { name: "奄美市", lat: 28.37, lon: 129.48 },
        { name: "南鳥島", lat: 24.28, lon: 153.98 },
        { name: "小笠原諸島", lat: 27.09, lon: 142.19 }
    ]
};

async function generateWeatherReport(mode, locations) {
    const allPoints = [];
    for (const region in locations) {
        locations[region].forEach(loc => {
            allPoints.push({ ...loc, region });
        });
    }

    const CHUNK_SIZE = 40;
    let allResults = [];

    for (let i = 0; i < allPoints.length; i += CHUNK_SIZE) {
        const chunk = allPoints.slice(i, i + CHUNK_SIZE);
        const lats = chunk.map(p => p.lat).join(',');
        const lons = chunk.map(p => p.lon).join(',');
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=weathercode,temperature_2m,precipitation_probability&timezone=Asia%2FTokyo`;

        try {
            console.log(`📡 天気データ取得中... (${i + 1}〜${Math.min(i + CHUNK_SIZE, allPoints.length)}地点目)`);
            const res = await axios.get(url);
            allResults = allResults.concat(Array.isArray(res.data) ? res.data : [res.data]);
        } catch (e) {
            console.error("🚨 天気データ取得失敗:", e.message);
            allResults = allResults.concat(new Array(chunk.length).fill(null));
        }
        await sleep(300);
    }

    let report = mode === 'morning' ? "☀️本日の広域予報\n" : "🌙明日の広域予報\n";
    const baseHour = mode === 'morning' ? 0 : 24;
    const amIdx = baseHour + 9;
    const pmIdx = baseHour + 15;

    const getEmoji = (c) => {
        if (c <= 1) return "☀️";
        if (c <= 3) return "⛅";
        if (c === 45 || c === 48) return "🌫️";
        if (c >= 51 && c <= 55) return "☔";
        if (c === 56 || c === 57 || c === 66 || c === 67) return "🧊☔";
        if (c === 61 || c === 80) return "☔";
        if (c === 63 || c === 81) return "🟨☔";
        if (c === 65 || c === 82) return "🟥☔";
        if (c >= 71 && c <= 75) return "❄️";
        if (c === 77) return "🧊";
        if (c >= 85 && c <= 86) return "⛄";
        if (c >= 95) return "⛈️";
        return "☁️";
    };

    let currentIndex = 0;
    for (const region in locations) {
        report += `\n●${region}\n`;
        for (const loc of locations[region]) {
            const data = allResults[currentIndex];
            if (data && data.hourly) {
                const h = data.hourly;
                const amE = getEmoji(h.weathercode[amIdx]);
                const amT = Math.round(h.temperature_2m[amIdx]);
                const pmE = getEmoji(h.weathercode[pmIdx]);
                const pmT = Math.round(h.temperature_2m[pmIdx]);
                const prob = Math.max(...h.precipitation_probability.slice(baseHour, baseHour + 24));
                report += `${loc.name}:${amE}${amT}→${pmE}${pmT}(${prob}%)\n`;
            } else {
                report += `${loc.name}:error\n`;
            }
            currentIndex++;
        }
    }

    report += "\n【凡例】\n表示: [午前9時] → [午後15時] (1日の最大降水確率%)\n🟨☔=強い雨 / 🟥☔=激しい雨 / ⬛☔=猛烈な雨 / ⛈️=雷雨 / 🧊=氷・あられ";

    return report;
}

// ================================
// 🧠 マルコフ生成
// ================================
function generateMarkov(words, brain) {
    const isSymbol = (str) => /^[^a-zA-Z0-9\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]+$/.test(str);

    const markovDict = {};
    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];
        if (!markovDict[w1]) markovDict[w1] = [];
        markovDict[w1].push(w2);
    }

    const pickNextWord = (list) => {
        if (!list || list.length === 0) return "";
        let candidate = list[Math.floor(Math.random() * list.length)];
        if (isSymbol(candidate) && Math.random() < 0.6) {
            candidate = list[Math.floor(Math.random() * list.length)];
        }
        let attempts = 0;
        while (/(マルコフ|おみくじ|タイムライン|@|#)/.test(candidate) && attempts < 5) {
            candidate = words[Math.floor(Math.random() * words.length)];
            attempts++;
        }
        return candidate;
    };

    const mm = Math.floor(Math.random() * (14 - 5 + 1)) + 5;
    let generated = "";
    let current_word = pickNextWord(words);

    for (let i = 0; i < mm; i++) {
        if (!current_word) current_word = pickNextWord(words);

        let foundNext = "";
        const useBrain = Math.random() < 0.7;

        if (useBrain && particles.includes(current_word) && brain[current_word]) {
            const candidates = brain[current_word];
            foundNext = candidates[Math.floor(Math.random() * candidates.length)];
        }

        if (!foundNext && markovDict[current_word]) {
            foundNext = pickNextWord(markovDict[current_word]);
        }

        current_word = foundNext || pickNextWord(words);

        if (/^[\u3040-\u309F]{8,}$|^[\u30A0-\u30FF]{8,}$/.test(current_word)) {
            current_word = pickNextWord(words);
            i--;
            continue;
        }

        generated += current_word;

        if (["。", "！", "？", "w", "…"].some(s => current_word.endsWith(s))) {
            break;
        }
    }

    let outputText = generated || "（言葉の断片が見つかりませんでした）";
    outputText = outputText
        .replace(/:.*?:/g, '')
        .replace(/[ 　]/g, '')
        .replace(/<.*?>/g, '')
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        .replace(/\\/g, '')
        .trim();

    return outputText;
}

// ================================
// 🌐 HTTP/HTTPSリクエスト（統一版）
// ================================
async function requestToMisskey(domain, token, path, payload) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ i: token, ...payload });
        const options = {
            hostname: domain,
            port: 443,
            path: `/api/${path}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Connection': 'close'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                } else {
                    reject(new Error(`API Error ${res.statusCode}: ${body.substring(0, 100)}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

// ================================
// 🚀 メイン処理
// ================================
async function main() {
    try {
        console.log("=== 📍 システム起動 ===");

        // 1. 環境変数チェック
        validateEnv();

        // 2. JSON.parse監視を有効化
        enableJSONParseGuard();

        // 3. APIキー選択
        const currentKey = selectAPIKey();

        // 4. Misskey初期化
        const { mk, config } = initializeMisskey();

        // 5. ログインユーザー取得
        const me = await mk.request('i');
        const my_id = me.id;
        console.log(`✓ ログイン: @${me.username} (${my_id})`);

        const domain = config.domain.replace(/^https?:\/\//, '').split('/')[0];
        const token = config.token;

        // 6. フォロバ・リムバ処理
        console.log("👤 フォロー整理を実行中...");
        await handleFollowControl(mk, my_id);

        // 7. DM処理（メンション前に実行）
        console.log("📨 DM処理を実行中...");
        await handleDirectMessages(mk, me, config, currentKey);

        // 8. メンション処理
        console.log("💬 メンション処理を実行中...");
        await handleMentions(mk, me, config, currentKey);

        // 9. 時間判定（日本時間）
        const nowJST = new Date(new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }));
        const hourJST = nowJST.getHours();
        const minJST = nowJST.getMinutes();

        const isMorning = (hourJST === 7 && minJST <= 15);
        const isEvening = (hourJST === 19 && minJST <= 15);
        const isMidnight = (hourJST === 0 && minJST <= 15);

        console.log(`【時間チェック】日本時間: ${hourJST}:${minJST} | 朝=${isMorning}, 夜=${isEvening}, 深夜=${isMidnight}`);

        // 10. 天気予報投稿（該当時間のみ）
        if (isMorning || isEvening || isMidnight) {
            console.log("🌡️ 天気予報モード起動...");

            const mode = isMorning ? 'morning' : 'evening';
            const dayLabel = isMorning ? "本日" : "明日";

            const finalReport = await generateWeatherReport(mode, weatherLocations);
            console.log(`📝 レポート作成完了（${finalReport.length}文字）`);

            await sleep(3000);

            try {
                await requestToMisskey(domain, token, 'notes/create', {
                    text: finalReport + legend,
                    cw: `${isMorning ? '☀️' : '🌙'} ${dayLabel}の全国広域予報`,
                    visibility: "public"
                });
                console.log(`✓ 全国広域予報(${mode})を投稿しました`);
            } catch (e) {
                console.error(`❌ 天気予報投稿失敗: ${e.message}`);
            }

            await sleep(4000);
        }

        // 11. 脳データの学習フェーズ
        console.log("📖 学習フェーズ開始...");
        await sleep(2000);

        // Google Drive認証
        const drive = await getDriveAuth();
        let brain = await loadBrainFromDrive(drive);
        brain = cleanBrain(brain);

        // タイムライン取得
        console.log("📥 タイムライン取得中...");
        const tlRaw = await requestToMisskey(domain, token, 'notes/hybrid-timeline', { limit: 84 });
        const tl = Array.isArray(tlRaw) ? tlRaw : (tlRaw?.notes || []);

        const tl_text = tl
            .filter(n => n && n.text && n.user.id !== my_id)
            .map(n => n.text.replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, '').trim())
            .join(" ");

        // 形態素解析
        const words = segmenter.segment(tl_text);
        console.log(`【分析実行】総単語数: ${words.length}`);

        // 学習 & 保存
        brain = learnBrain(brain, words);
        await saveBrainToDrive(drive, brain);

        const vocabularyCount = Object.keys(brain).length;
        const connectionCount = Object.values(brain).reduce((acc, curr) => acc + curr.length, 0);

        console.log(`✓ 脳の更新完了！`);
        console.log(`📊 語彙数: ${vocabularyCount}`);
        console.log(`⚖️ 総重み数: ${connectionCount}`);

        // 12. マルコフ連鎖生成
        let outputText = generateMarkov(words, brain);

        let retryCount = 0;
        while ((!outputText || outputText.length < 4) && retryCount < 5) {
            if (retryCount > 0) console.log(`🔄 再生成試行中... (${retryCount}回目)`);
            outputText = generateMarkov(words, brain);
            retryCount++;
        }

        // 手動実行タグ付与
        const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.GITHUB_ACTIONS;
        if (isManual) {
            outputText = `【手動実行】\n${outputText}`;
            console.log("✓ 手動実行を検知。タグを付与しました");
        }

        // 13. 最終投稿
        console.log("📤 Misskeyに投稿中...");
        try {
            const resData = await requestToMisskey(domain, token, 'notes/create', {
            text: outputText.trim().slice(0, 110),
            visibility: 'home' // ここを 'home' から 'public' に変更
        });
            console.log(`✓ 投稿成功！ Note ID: ${resData.createdNote?.id || "N/A"}`);
        } catch (err) {
            console.error(`❌ 投稿失敗: ${err.message}`);
        }

        console.log(`\n✓✓✓ 全工程完了 ✓✓✓`);
        console.log(`内容: ${outputText}`);

    } catch (e) {
        console.error(`\n❌ 致命的エラー: ${e.message}`);
        console.error(e.stack);
    }
}

// ================================
// ▶️ 実行開始
// ================================
main().catch(err => {
    console.error("🚨 Top-level Catch:", err);
    process.exit(1);
});
