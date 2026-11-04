const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msg = t => { $('msg').textContent = t; };

let dates = []; // { match_id, played_on, duration_sec, players }

async function loadDates() {
  $('summary').textContent = '掃描中…';
  $('dateList').innerHTML = '';
  try {
    const r = await fetch('/api/matches?list_dates=1');
    if (!r.ok) throw new Error('讀取失敗 ' + r.status);
    dates = await r.json();
  } catch (e) {
    $('summary').textContent = '無法載入日期清單：' + e.message;
    return;
  }
  const totalPlayers = dates.reduce((s, d) => s + (d.players || 0), 0);
  $('summary').textContent = dates.length
    ? `共 ${dates.length} 個場次、${totalPlayers} 筆玩家戰績`
    : '資料庫中目前沒有場次';
  $('dateList').innerHTML = dates.map(d =>
    `<span class="date-chip" data-d="${esc(d.played_on)}" title="點一下填入起訖日">${esc(d.played_on)} <b>${d.players || 0}人</b></span>`
  ).join('');
  updatePreview();
}

function inRange(played_on, from, to) {
  return from && to && played_on >= from && played_on <= to;
}

function updatePreview() {
  const from = $('from').value, to = $('to').value;
  const hit = dates.filter(d => inRange(d.played_on, from, to));
  const players = hit.reduce((s, d) => s + (d.players || 0), 0);
  const okConfirm = $('confirm').value.trim() === 'confirm';
  $('doDelete').disabled = !(from && to && from <= to && hit.length && okConfirm);

  if (!from || !to) {
    $('preview').innerHTML = '請選擇起訖日期，將顯示會被刪除的場次與人數。';
    return;
  }
  if (from > to) {
    $('preview').innerHTML = '<strong>起始日不能晚於結束日。</strong>';
    return;
  }
  if (!hit.length) {
    $('preview').innerHTML = `區間 ${esc(from)} ～ ${esc(to)} 內沒有場次。`;
    return;
  }
  const list = hit.map(d => `${esc(d.played_on)}（${d.players || 0}人）`).join('、');
  $('preview').innerHTML =
    `將刪除 <strong>${hit.length}</strong> 場、共 <strong>${players}</strong> 筆玩家戰績：<br>${list}`;
}

$('from').oninput = $('to').oninput = $('confirm').oninput = updatePreview;
$('refresh').onclick = loadDates;

$('dateList').onclick = e => {
  const chip = e.target.closest('[data-d]');
  if (!chip) return;
  const d = chip.dataset.d;
  if (!$('from').value) $('from').value = d;
  else if (!$('to').value) $('to').value = d;
  else { $('from').value = d; $('to').value = d; }
  updatePreview();
};

$('doDelete').onclick = async () => {
  const from = $('from').value, to = $('to').value;
  if ($('confirm').value.trim() !== 'confirm') return msg('請輸入 confirm');
  const hit = dates.filter(d => inRange(d.played_on, from, to));
  if (!hit.length) return;
  if (!confirm(`確定刪除 ${from} ～ ${to} 的 ${hit.length} 場戰績？\n此操作無法復原。`)) return;

  $('doDelete').disabled = true;
  msg('刪除中…');
  const r = await fetch('/api/matches', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, confirm: 'confirm' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    msg('失敗：' + (j.error || r.status));
    $('doDelete').disabled = false;
    return;
  }
  msg(`✅ 已刪除 ${j.deleted_matches || 0} 場、${j.deleted_rows || 0} 筆玩家戰績`);
  $('confirm').value = '';
  $('from').value = '';
  $('to').value = '';
  await loadDates();
};

(async () => {
  const me = await (await fetch('/api/auth/me')).json();
  $('who').textContent = me ? (me.name || me.id) : '';
  if (!me) { $('gate').hidden = false; return; }
  if (me.role !== 'admin') {
    $('gate').hidden = false;
    $('gate').innerHTML = '<p>資料清理僅限管理員。</p><p><a href="/">回戰績查詢</a></p>';
    return;
  }
  $('app').hidden = false;
  $('adminLink').hidden = false;
  loadDates();
})();
