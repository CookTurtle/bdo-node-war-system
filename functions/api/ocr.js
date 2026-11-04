// POST /api/ocr：已登入的白名單使用者才能呼叫（_middleware 會擋）。
// 直接用 fetch 呼叫 Gemini REST API，不依賴任何 SDK；API key 只存在 Cloudflare secret，不會進瀏覽器。
const FIELDS = ['family_name', 'kills', 'deaths', 'max_streak', 'dmg_dealt', 'dmg_taken', 'cc_hits', 'heal', 'ally_heal',
  'fort_dmg', 'cannon_shots', 'cannon_kills', 'cannon_max_dist', 'traps', 'dead_sec', 'alive_sec'];

const PROMPT = `這是《黑色沙漠》據點戰的戰績表截圖。
請只讀取清楚的主表格，由上到下每位玩家一列。
忽略表頭、職業圖示、以及背景中半透明/重疊的第二層雜字。

每位玩家必須嚴格輸出以下 16 個欄位，順序固定，一個都不能少、也不能多、也不能把後面的數字往前挪：
1. family_name（家門名稱）
2. kills（擊殺數）
3. deaths（死亡數）
4. max_streak（最多連續擊殺）
5. dmg_dealt（造成傷害量）
6. dmg_taken（受到傷害量）
7. cc_hits（控制命中數）
8. heal（生命力恢復量）
9. ally_heal（我軍生命力恢復量）
10. fort_dmg（對要塞及指揮所傷害量）
11. cannon_shots（大砲打擊次數）
12. cannon_kills（大砲破壞建築數）
13. cannon_max_dist（大砲最大打擊距離）
14. traps（陷阱觸發次數）
15. dead_sec（死亡時間，格式 mm:ss）
16. alive_sec（生存時間，格式 mm:ss）

重要規則：
- 所有值都輸出為字串，照畫面原樣抄寫，保留「萬」字，不要換算、不要補零。
- 家門名稱中英文字元照原樣輸出。
- 看不清楚就輸出空字串，絕對不要猜、不要跳過該欄把後面的值往前填。
- 數字欄位即使是 0 也要輸出 "0"，不要省略。
- 時間欄位必須是 mm:ss 格式（例如 08:43），不要跟其他數字搞混。
- 不要漏列任何玩家。`;

// 依成員名單修正家門名稱：只差一兩個字、且只有唯一最相近者才修正（名單以外的名字原樣保留）
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return d[b.length];
}
export function fixName(raw, roster) {
  if (!raw || !roster.length || roster.includes(raw)) return raw;
  const q = raw.toLowerCase(), lim = q.length <= 2 ? 0 : q.length <= 4 ? 1 : 2;
  let best = null, bd = Infinity, tie = false;
  for (const n of roster) {
    const d = lev(q, n.toLowerCase());
    if (d < bd) { bd = d; best = n; tie = false; } else if (d === bd) tie = true;
  }
  return best && bd <= lim && !tie ? best : raw;
}

const SCHEMA = { type: 'ARRAY', items: { type: 'OBJECT', required: FIELDS,
  properties: Object.fromEntries(FIELDS.map(k => [k, { type: 'STRING' }])) } };

function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
const fail = (error, status = 502) => Response.json({ error }, { status });

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return fail('尚未設定 GEMINI_API_KEY', 500);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > 8e6) return fail('圖片為空或超過 8MB', 413);
  let roster = [];       // 成員名單（資料表不存在或為空時就當沒有）
  try { roster = (await env.DB.prepare('SELECT name FROM members').all()).results.map(r => r.name); } catch {}
  const prompt = roster.length ? PROMPT + `
已知成員名單（共 ${roster.length} 人）：${roster.join('、')}
家門名稱請優先對照這份名單：若你讀到的名字與名單中某位非常相似（只差一兩個字，可能是圖片太小或解析度造成的誤判），請輸出名單中的正確寫法；名單以外的名字照原樣輸出，不要硬套名單。` : PROMPT;
  // 允許前端下拉選擇，僅白名單內的模型；否則回退到 secret 或預設
  const ALLOWED = new Set(['gemini-2.5-flash', 'gemini-3.1-flash-lite']);
  const q = new URL(request.url).searchParams.get('model') || '';
  const model = ALLOWED.has(q) ? q : (env.GEMINI_MODEL || 'gemini-3.1-flash-lite');
  const mime = (request.headers.get('content-type') || 'image/jpeg').split(';')[0];

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64(body) } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      }),
    });
  } catch { return fail('連不到 Gemini API'); }

  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 429 ? '（免費額度用完或太頻繁，請稍後再試）' : res.status === 404 ? '（請檢查 GEMINI_MODEL 名稱）' : '';
    return fail(`Gemini 回應 ${res.status}：${j.error?.message || '未知錯誤'}${hint}`, res.status === 429 ? 429 : 502);
  }
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  let rows; try { rows = JSON.parse(text); } catch { return fail('模型沒有回傳可解析的 JSON，請重試或換模型'); }
  if (!Array.isArray(rows) || !rows.length) return fail('沒有辨識到任何資料列，請確認截圖包含完整表格');
  for (const r of rows) {      // 模型沒照名單修正時，再用名單比對一次
    const raw = String(r.family_name || '').replace(/\s/g, ''), fixed = fixName(raw, roster);
    if (fixed !== raw) { r.name_fixed_from = raw; r.family_name = fixed; }
  }
  return Response.json({ rows });
}
