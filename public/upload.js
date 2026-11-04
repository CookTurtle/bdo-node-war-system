const $ = id => document.getElementById(id), cv = $('cv');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NUM = ['kills','deaths','max_streak','dmg_dealt','dmg_taken','cc_hits','heal','ally_heal','fort_dmg','cannon_shots','cannon_kills','cannon_max_dist','traps','dead_sec','alive_sec'];
const LABEL = ['擊殺','死亡','連殺','造成傷害','受到傷害','控制命中','生命力恢復','我軍恢復','要塞傷害','大砲打擊','大砲破壞','最大距離','陷阱','死亡時間','生存時間'];
const STYLE_ZH = { '': '?', succession: '繼承', awakening: '覺醒', open: '開放' };
const isTime = k => k === 'dead_sec' || k === 'alive_sec';

// 圖示位置改由 icons.js 在框選範圍內自動偵測；這裡只剩比對門檻。
const CFG = { matchMin: 0.8 };   // 職業圖示相似度門檻（0~1）

let IMG = null, imgUrl = null, sel = null, drag = null, layout = null, rows = [], TPL = [], names = [], nameSet = new Set(), durTouched = false;
const workers = {};
const msg = t => $('status').textContent = t;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const unparsable = (r, k) => !Number.isFinite(isTime(k) ? parseTime(r[k]) : parseNum(r[k]));

// ---------- 解析 ----------
const parseNum = s => { s = String(s).replace(/[,\s]/g, ''); const m = s.match(/^(\d+(?:\.\d+)?)萬$/);
  return m ? Math.round(m[1] * 1e4) : /^\d+$/.test(s) ? +s : NaN; };
const parseTime = s => { const m = String(s).match(/^(\d{1,3}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : NaN; };
const fmt = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const norm = v => { const m = v.reduce((a, b) => a + b) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
  return Float32Array.from(v, x => (x - m) / sd); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / a.length;
function lev(a, b) { const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return d[b.length]; }
function nearest(n) { let best = null, bd = n.length > 3 ? 2 : 1;
  for (const x of names) { const d = lev(n, x); if (d > 0 && d <= bd) { best = x; bd = d; } } return best; }

// ---------- 圖示：職業用模板比對，繼承/覺醒/開放用色相 ----------
function grayVec(x, y, w, h) {
  const c = Object.assign(document.createElement('canvas'), { width: 32, height: 32 }), g = c.getContext('2d');
  g.drawImage(IMG, x, y, w, h, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  return { vec: Array.from({ length: 1024 }, (_, i) => Math.round(d[i*4]*.3 + d[i*4+1]*.59 + d[i*4+2]*.11)), url: c.toDataURL(), px: d };
}
function match(vec) { const v = norm(vec); let b = { id: '', score: -1 };
  for (const t of TPL) { const s = dot(v, t.v); if (s > b.score) b = { id: t.id, score: s }; } return b; }
function styleOf(d) {            // 藍＝繼承、紅/橙＝覺醒、黃/綠＝開放；門檻請依實際截圖微調
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 100 || (mx - mn) / mx < .3) continue;
    const h = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b); sx += Math.cos(h); sy += Math.sin(h); n++;
  }
  if (n < 8) return '';
  const deg = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
  if (deg < 40 || deg > 320) return 'awakening';   // 紅～橙
  if (deg > 180 && deg < 280) return 'succession'; // 藍～青
  if (deg >= 40 && deg < 160) return 'open';       // 黃～綠
  return '';
}

// ---------- 切格與 OCR ----------
function relocate() {      // 依框選範圍與列數，自動找出每列的職業/類型圖示位置
  layout = null;
  const n = +$('rowCount').value;
  if (!IMG || !sel || sel.w < 12 || sel.h < 20 || !(n >= 1)) return;
  const x = Math.max(0, Math.round(sel.x)), y = Math.max(0, Math.round(sel.y)),
    w = Math.min(IMG.width - x, Math.round(sel.w)), h = Math.min(IMG.height - y, Math.round(sel.h));
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(IMG, x, y, w, h, 0, 0, w, h);
  const L = locateIcons(g.getImageData(0, 0, w, h).data, w, h, n);
  if (!L) return;
  const off = b => b && [b[0] + x, b[1] + y, b[2], b[3]];
  layout = { ...L, cells: L.cells.map(c => ({ cls: off(c.cls), sty: off(c.sty) })) };
}
async function shrink(img, maxW = 1600) {   // 縮成 JPEG 再送出，省流量與額度
  const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', .9));
}
async function run() {
  $('run').disabled = true;
  try {
    msg('AI 辨識中…（約 5–20 秒）');
    const model = $('model')?.value || 'gemini-3.1-flash-lite';
    const res = await fetch('/api/ocr?model=' + encodeURIComponent(model), {
      method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: await shrink(IMG)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.detail || j.error || res.status);
    const out = j.rows.map(r => ({ ...r, family_name: String(r.family_name || '').replace(/\s/g, ''),
      class_id: '', auto_class: '', style: '', vec: null, thumb: BLANK }));
    let note = '';
    if (sel && sel.w >= 12 && sel.h >= 20) {      // 有框選才處理職業與類型圖示；第 i 個圖示對應第 i 列資料
      $('rowCount').value = out.length; relocate(); draw();
      if (!layout) note = ' 框選範圍內找不到圖示，職業請手動填寫。';
      else {
        if (layout.equalSplit) note = ' 圖示位置信心偏低，已改為等分切格，請對照縮圖檢查。';
        else if (layout.cols.length > 2) note = ' 偵測到超過 2 欄圖示，請把框縮到只包住職業與類型圖示。';
        out.forEach((row, i) => {
          const c = layout.cells[i], ic = grayVec(...c.cls), m = match(ic.vec);
          Object.assign(row, { vec: ic.vec, thumb: ic.url, class_id: m.score >= CFG.matchMin ? m.id : '' });
          row.auto_class = row.class_id; row.style = c.sty ? styleOf(grayVec(...c.sty).px) : '';
        });
      }
    }
    for (const o of out) { const k = rows.findIndex(x => x.family_name === o.family_name); k >= 0 ? rows[k] = o : rows.push(o); }
    render(); msg(`辨識完成：${out.length} 列。請對照截圖檢查，橘框是無法解析的欄位。` + note);
  } catch (e) { msg('辨識失敗：' + e.message); }
  $('run').disabled = false;
}

// ---------- 確認表格 ----------
$('th').innerHTML = '<tr><th><th>家門名稱<th>職業<th>' + ['類型', ...LABEL].join('<th>') + '<th></tr>';
function render() {
  $('tb').innerHTML = rows.map((r, i) => {
    const sug = !names.length || nameSet.has(r.family_name) ? '' : (b => b ? ` <a href="#" data-sug="${esc(b)}">→${esc(b)}</a>` : '')(nearest(r.family_name));
    return `<tr data-i="${i}"><td><img src="${r.thumb}" width="28" height="28" alt="">` +
      `<td><input data-k="family_name" value="${esc(r.family_name)}" size="10" class="${r.family_name ? '' : 'warn'}">${sug}` +
      `<td><input data-k="class_id" list="classes" value="${esc(r.class_id)}" size="8">` +
      `<td><select data-k="style">${Object.entries(STYLE_ZH).map(([v, z]) => `<option value="${v}"${v === r.style ? ' selected' : ''}>${z}</option>`).join('')}</select>` +
      NUM.map(k => `<td><input data-k="${k}" value="${esc(r[k])}" size="6" class="${unparsable(r, k) ? 'warn' : ''}">`).join('') +
      `<td><button data-del title="刪除這列">✕</button>`;
  }).join('');
  check();
}
function check() {
  const sums = rows.map(r => parseTime(r.dead_sec) + parseTime(r.alive_sec)).filter(Number.isFinite);
  if (!durTouched && sums.length) { const c = {}; sums.forEach(s => c[s] = (c[s] || 0) + 1);
    $('dur').value = fmt(+Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]); }
  const D = parseTime($('dur').value);
  $('tb').querySelectorAll('tr').forEach((tr, i) => {
    const r = rows[i], dead = tr.querySelector('[data-k=dead_sec]'), alive = tr.querySelector('[data-k=alive_sec]');
    const ok = parseTime(r.dead_sec) + parseTime(r.alive_sec) === D;
    dead.classList.toggle('bad', !ok); alive.classList.toggle('bad', !ok);
    dead.title = ok || !Number.isFinite(D) ? '' : `建議：${fmt(Math.max(D - parseTime(r.alive_sec), 0) || 0)}`;
    alive.title = ok || !Number.isFinite(D) ? '' : `建議：${fmt(Math.max(D - parseTime(r.dead_sec), 0) || 0)}`;
  });
}
$('tb').addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return;
  rows[e.target.closest('tr').dataset.i][k] = e.target.value; if (isTime(k)) check(); });
$('tb').addEventListener('change', e => {
  if (e.target.dataset.k !== 'class_id') return;
  const v = rows[e.target.closest('tr').dataset.i]; if (!v.class_id || !v.vec) return;
  const a = norm(v.vec);        // 同一種圖示、尚未填職業的列，自動帶入同一個職業
  rows.forEach(o => { if (!o.class_id && o.vec && dot(norm(o.vec), a) > .9) o.class_id = v.class_id; }); render(); });
$('tb').addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (!tr) return;
  if (e.target.dataset.del !== undefined) { rows.splice(+tr.dataset.i, 1); render(); }
  if (e.target.dataset.sug) { e.preventDefault(); rows[+tr.dataset.i].family_name = e.target.dataset.sug; render(); } });
$('dur').oninput = () => { durTouched = true; check(); };

// ---------- 上傳 ----------
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, j: await res.json().catch(() => ({})) };
}
function askDate() {
  return new Promise(resolve => {
    const dlg = $('dateDlg'), inp = $('dlgDate');
    // 不預填日期；用 max 讓日曆面板以「今天」為參考起點（多數瀏覽器會打開在今天附近）
    inp.value = '';
    inp.max = new Date().toLocaleDateString('sv');
    const done = v => { dlg.close(); resolve(v); };
    $('dlgCancel').onclick = () => done(null);
    $('dlgOk').onclick = () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) { inp.focus(); return; }
      done(inp.value);
    };
    dlg.onclose = () => { /* 點 backdrop 關閉時當取消 */ if (dlg.returnValue === undefined) resolve(null); };
    dlg.showModal();
    // 延遲 focus，讓 dialog 動畫完再開日曆（部分瀏覽器支援 showPicker）
    setTimeout(() => { try { inp.focus(); inp.showPicker?.(); } catch {} }, 50);
  });
}
$('submit').onclick = async () => {
  const out = $('result'), D = parseTime($('dur').value);
  if (!rows.length) return out.textContent = '還沒有資料';
  if (!Number.isFinite(D)) return out.textContent = '比賽時長格式應為 分:秒，例如 35:00';
  const played_on = await askDate();
  if (!played_on) return out.textContent = '已取消上傳';
  const match_ = { played_on, duration_sec: D }, data = [];
  for (const r of rows) {
    const o = { family_name: r.family_name.trim(), class_id: r.class_id.trim() || null, style: r.style || null };
    for (const [i, k] of NUM.entries()) { const v = isTime(k) ? parseTime(r[k]) : parseNum(r[k]);
      if (!Number.isFinite(v)) return out.textContent = `「${o.family_name || '未命名'}」的${LABEL[i]}無法解析：${r[k]}`; o[k] = v; }
    data.push(o);
  }
  out.textContent = '上傳中…';
  const res = await post('/api/matches', { match: match_, rows: data });
  if (!res.ok) return out.textContent = '上傳失敗：' + (res.j.error || '未知錯誤');
  const seen = new Set();       // 使用者修正過的職業圖示 → 存成模板（每個職業每次最多一張）
  for (const r of rows) if (r.vec && r.class_id && r.class_id !== r.auto_class && !seen.has(r.class_id)) {
    seen.add(r.class_id); await post('/api/templates', { class_id: r.class_id, vec: r.vec }); }
  out.textContent = `已上傳 ${res.j.count} 人（日期 ${played_on}）。`;
};

// ---------- 圖片與框選 ----------
function draw() {
  const g = cv.getContext('2d'); cv.width = IMG.width; cv.height = IMG.height; g.drawImage(IMG, 0, 0);
  if (!sel) return;
  g.lineWidth = Math.max(1, IMG.width / 800); g.strokeStyle = '#c9a45c'; g.strokeRect(sel.x, sel.y, sel.w, sel.h);
  if (layout && !drag) for (const c of layout.cells) {
    g.strokeStyle = 'rgba(80,200,255,.8)'; g.strokeRect(...c.cls);
    if (c.sty) { g.strokeStyle = 'rgba(255,160,70,.8)'; g.strokeRect(...c.sty); }
  }
}
const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * IMG.width, y: (e.clientY - r.top) / r.height * IMG.height }; };
cv.onpointerdown = e => { if (!IMG) return; drag = pt(e); sel = { x: drag.x, y: drag.y, w: 0, h: 0 }; cv.setPointerCapture(e.pointerId); };
cv.onpointermove = e => { if (!drag) return; const p = pt(e);
  sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; draw(); };
cv.onpointerup = () => { drag = null; relocate(); draw(); };
$('rowCount').oninput = () => { if (IMG) { relocate(); draw(); } };
$('run').onclick = run;
function loadBlob(blob, label) {
  const url = URL.createObjectURL(blob), im = new Image();
  im.onload = () => {
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    imgUrl = url; IMG = im; sel = null; layout = null; $('run').disabled = false; draw();
    msg(`${label}（${im.width}×${im.height}）。可先框選圖示欄，再按「AI 辨識」。`);
  };
  im.onerror = () => { URL.revokeObjectURL(url); msg('無法讀取這張圖片'); };
  im.src = url;
}
$('file').onchange = e => { const f = e.target.files[0]; if (f) loadBlob(f, '已載入圖片'); };

// 貼上：Ctrl+V / ⌘V。剪貼簿沒有圖片時不攔截，輸入框裡的一般文字貼上不受影響。
document.addEventListener('paste', e => {
  if ($('app').hidden) return;
  const it = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (!it) return;
  e.preventDefault(); loadBlob(it.getAsFile(), '已貼上圖片');
});
// 按鈕版（需瀏覽器授權讀取剪貼簿；不支援時提示改按 Ctrl+V）
$('paste').onclick = async () => {
  try {
    for (const it of await navigator.clipboard.read()) {
      const t = it.types.find(t => t.startsWith('image/'));
      if (t) return loadBlob(await it.getType(t), '已貼上圖片');
    }
    msg('剪貼簿裡沒有圖片，請先截圖（例如 Win+Shift+S）。');
  } catch { msg('瀏覽器不允許讀取剪貼簿，請直接按 Ctrl+V（Mac：⌘V）。'); }
};


// ---------- 初始化 ----------
(async () => {
  const me = await (await fetch('/api/auth/me')).json();
  $('who').textContent = me ? (me.name || me.id) : '';
  if (!me) { $('gate').hidden = false; return; }
  if (me.role !== 'admin') {
    $('gate').hidden = false;
    $('gate').innerHTML = '<p>上傳戰績僅限管理員。</p><p>一般成員請回 <a href="/">戰績查詢</a>。</p>';
    return;
  }
  $('app').hidden = false;
  $('adminLink').hidden = false;
  const [t, n] = await Promise.all([fetch('/api/templates').then(r => r.json()), fetch('/api/players').then(r => r.json())]);
  TPL = t.map(x => ({ id: x.class_id, v: norm(x.vec) })); names = n; nameSet = new Set(n);
  $('classes').innerHTML = [...new Set(t.map(x => x.class_id))].map(c => `<option value="${esc(c)}">`).join('');
})();
