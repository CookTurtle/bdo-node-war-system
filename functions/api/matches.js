// GET：最近場次 / 指定日期 / 日期清單；POST：上傳；PATCH：改日期或職業；DELETE：依日期範圍刪除
const NUM = ['kills','deaths','max_streak','dmg_dealt','dmg_taken','cc_hits','heal','ally_heal','fort_dmg',
  'cannon_shots','cannon_kills','cannon_max_dist','traps','dead_sec','alive_sec'];
const STYLES = ['succession', 'awakening', 'open'];
const bad = (error, status = 400) => Response.json({ error }, { status });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const listDates = url.searchParams.get('list_dates');

  // 列出所有有資料的日期（含人數），供刪除頁選取
  if (listDates) {
    const { results } = await env.DB.prepare(`
      SELECT m.id AS match_id, m.played_on, m.duration_sec,
             COUNT(p.family_name) AS players
      FROM matches m
      LEFT JOIN player_stats p ON p.match_id = m.id
      WHERE m.guild = '' AND m.node = ''
      GROUP BY m.id
      ORDER BY m.played_on ASC
    `).all();
    return Response.json(results || []);
  }

  if (date) {
    if (!isDate(date)) return bad('日期格式應為 YYYY-MM-DD');
    const mt = await env.DB.prepare(
      `SELECT id,played_on,duration_sec FROM matches WHERE played_on=? AND guild='' AND node=''`
    ).bind(date).first();
    if (!mt) return Response.json({ match: null, rows: [] });
    const { results } = await env.DB.prepare(
      `SELECT family_name,class_id,style,${NUM.join(',')} FROM player_stats WHERE match_id=? ORDER BY family_name`
    ).bind(mt.id).all();
    return Response.json({ match: mt, rows: results });
  }

  const { results } = await env.DB.prepare(
    'SELECT id,played_on,duration_sec FROM matches ORDER BY played_on DESC, id DESC LIMIT 50').all();
  return Response.json(results);
}

export async function onRequestPost({ request, env, data }) {
  let b; try { b = await request.json(); } catch { return bad('JSON 格式錯誤'); }
  const m = b.match || {}, rows = b.rows;
  if (!isDate(m.played_on) || !(m.duration_sec > 0 && m.duration_sec <= 14400)) return bad('場次資料不完整');
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) return bad('玩家資料數量不正確');
  for (const r of rows) {
    if (typeof r.family_name !== 'string' || !r.family_name || r.family_name.length > 30) return bad('家門名稱不正確');
    if (r.style != null && !STYLES.includes(r.style)) return bad(`${r.family_name} 的繼承/覺醒/開放不正確`);
    for (const k of NUM) if (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 1e10) return bad(`${r.family_name} 的 ${k} 不正確`);
    if (r.dead_sec + r.alive_sec !== m.duration_sec) return bad(`${r.family_name} 的死亡+生存時間與場次時長不符`);
  }
  await env.DB.prepare(`INSERT INTO matches(played_on,guild,node,duration_sec,uploader) VALUES(?,'','',?,?)
    ON CONFLICT(played_on,guild,node) DO NOTHING`).bind(m.played_on, m.duration_sec, data.user.discord_id).run();
  const mt = await env.DB.prepare(`SELECT id,duration_sec FROM matches WHERE played_on=? AND guild='' AND node=''`)
    .bind(m.played_on).first();
  if (mt.duration_sec !== m.duration_sec) return bad('與已存在場次的時長不一致', 409);

  const cols = ['family_name', 'class_id', 'style', ...NUM];
  const sql = `INSERT OR REPLACE INTO player_stats(match_id,${cols}) VALUES(${'?,'.repeat(cols.length)}?)`;
  const stmts = rows.map(r => env.DB.prepare(sql).bind(mt.id, ...cols.map(c =>
    c === 'class_id' ? (r.class_id ? String(r.class_id).slice(0, 30) : null) : (r[c] ?? null))));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return Response.json({ ok: true, match_id: mt.id, count: rows.length });
}

// DELETE：依日期範圍刪除場次與玩家戰績
// body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', confirm: 'confirm' }
export async function onRequestDelete({ request, env }) {
  let b; try { b = await request.json(); } catch { return bad('JSON 格式錯誤'); }
  if (b.confirm !== 'confirm') return bad('請在 confirm 欄位輸入 confirm 以確認刪除');
  if (!isDate(b.from) || !isDate(b.to)) return bad('起訖日期格式應為 YYYY-MM-DD');
  if (b.from > b.to) return bad('起始日期不能晚於結束日期');

  const { results: matches } = await env.DB.prepare(
    `SELECT id, played_on FROM matches
     WHERE guild='' AND node='' AND played_on >= ? AND played_on <= ?`
  ).bind(b.from, b.to).all();

  if (!matches.length) return Response.json({ ok: true, deleted_matches: 0, deleted_rows: 0, dates: [] });

  const ids = matches.map(m => m.id);
  // 分批刪 player_stats，再刪 matches
  let deletedRows = 0;
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const ph = chunk.map(() => '?').join(',');
    const r = await env.DB.prepare(`DELETE FROM player_stats WHERE match_id IN (${ph})`).bind(...chunk).run();
    deletedRows += r.meta?.changes || 0;
  }
  const ph2 = ids.map(() => '?').join(',');
  const rm = await env.DB.prepare(`DELETE FROM matches WHERE id IN (${ph2})`).bind(...ids).run();

  return Response.json({
    ok: true,
    deleted_matches: rm.meta?.changes || ids.length,
    deleted_rows: deletedRows,
    dates: matches.map(m => m.played_on),
  });
}

// PATCH：改整場日期，或改單一玩家的職業/型態（保留給進階用途）
export async function onRequestPatch({ request, env }) {
  let b; try { b = await request.json(); } catch { return bad('JSON 格式錯誤'); }
  const mid = +b.match_id;
  if (!Number.isInteger(mid) || mid < 1) return bad('缺少 match_id');

  if (b.action === 'set_date') {
    if (!isDate(b.played_on)) return bad('日期格式應為 YYYY-MM-DD');
    const exists = await env.DB.prepare(
      `SELECT id FROM matches WHERE played_on=? AND guild='' AND node='' AND id!=?`
    ).bind(b.played_on, mid).first();
    if (exists) return bad('目標日期已有場次，請先處理衝突', 409);
    const r = await env.DB.prepare('UPDATE matches SET played_on=? WHERE id=?').bind(b.played_on, mid).run();
    if (!r.meta?.changes) return bad('找不到該場次', 404);
    return Response.json({ ok: true, played_on: b.played_on });
  }

  if (b.action === 'set_player') {
    const name = String(b.family_name || '').trim();
    if (!name || name.length > 30) return bad('家門名稱不正確');
    if (b.style != null && b.style !== '' && !STYLES.includes(b.style)) return bad('繼承/覺醒/開放不正確');
    const class_id = b.class_id != null ? (String(b.class_id).trim().slice(0, 30) || null) : undefined;
    const style = b.style === '' ? null : (b.style ?? undefined);
    if (class_id === undefined && style === undefined) return bad('沒有要修改的欄位');
    const sets = [], binds = [];
    if (class_id !== undefined) { sets.push('class_id=?'); binds.push(class_id); }
    if (style !== undefined) { sets.push('style=?'); binds.push(style); }
    binds.push(mid, name);
    const r = await env.DB.prepare(
      `UPDATE player_stats SET ${sets.join(',')} WHERE match_id=? AND family_name=?`
    ).bind(...binds).run();
    if (!r.meta?.changes) return bad('找不到該玩家在此場次的資料', 404);
    return Response.json({ ok: true });
  }

  return bad('未知 action，請用 set_date 或 set_player');
}
