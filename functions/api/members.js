// 成員名單 + 公會：只有管理員能讀寫。AI 辨識時只使用 name 欄做對照。
import { getUser } from '../../lib/session.js';
const isAdmin = u => u && u.role === 'admin';
const clean = s => String(s ?? '').replace(/\s/g, '').slice(0, 30);
const deny = () => Response.json({ error: '需要管理員權限' }, { status: 403 });
const bad = (error, status = 400) => Response.json({ error }, { status });

export async function onRequestGet({ request, env }) {
  if (!isAdmin(await getUser(request, env))) return deny();
  const [g, m] = await Promise.all([
    env.DB.prepare('SELECT name FROM guilds ORDER BY name').all(),
    env.DB.prepare('SELECT name, guild FROM members ORDER BY guild IS NULL, guild, name').all(),
  ]);
  return Response.json({
    guilds: (g.results || []).map(r => r.name),
    members: (m.results || []).map(r => ({ name: r.name, guild: r.guild || '' })),
  });
}

export async function onRequestPost({ request, env, data }) {
  if (!isAdmin(data.user)) return deny();
  let b; try { b = await request.json(); } catch { return bad('JSON 格式錯誤'); }

  // 新增公會：{ type:'guild', name }
  if (b.type === 'guild') {
    const name = clean(b.name);
    if (!name) return bad('公會名稱不能為空');
    const r = await env.DB.prepare('INSERT OR IGNORE INTO guilds(name) VALUES(?)').bind(name).run();
    return Response.json({ ok: true, added: r.meta?.changes ? 1 : 0 });
  }

  // 新增成員：{ type:'members', guild?, names:[] }
  // 相容舊格式：{ names:[] }（無公會）
  const names = [...new Set((Array.isArray(b.names) ? b.names : []).map(clean).filter(Boolean))];
  if (!names.length || names.length > 500) return bad('一次請新增 1～500 個名字');
  let guild = b.guild != null ? clean(b.guild) : '';
  if (guild) {
    const exists = await env.DB.prepare('SELECT 1 FROM guilds WHERE name=?').bind(guild).first();
    if (!exists) return bad('公會不存在，請先新增公會');
  } else {
    guild = null;
  }
  const total = (await env.DB.prepare('SELECT COUNT(*) c FROM members').first()).c;
  if (total + names.length > 2000) return bad('名單已達上限（2000）', 409);
  // INSERT OR IGNORE 只看 PRIMARY KEY(name)；若已存在則不更新公會
  const res = await env.DB.batch(names.map(n =>
    env.DB.prepare('INSERT OR IGNORE INTO members(name, guild) VALUES(?,?)').bind(n, guild)));
  return Response.json({ ok: true, added: res.reduce((s, r) => s + (r.meta?.changes || 0), 0) });
}

export async function onRequestDelete({ request, env, data }) {
  if (!isAdmin(data.user)) return deny();
  const url = new URL(request.url);
  const guild = url.searchParams.get('guild');
  const name = url.searchParams.get('name');

  if (guild) {
    // 刪公會前先清空成員的 guild 欄
    await env.DB.batch([
      env.DB.prepare('UPDATE members SET guild=NULL WHERE guild=?').bind(guild),
      env.DB.prepare('DELETE FROM guilds WHERE name=?').bind(guild),
    ]);
    return Response.json({ ok: true });
  }
  if (name) {
    await env.DB.prepare('DELETE FROM members WHERE name=?').bind(name).run();
    return Response.json({ ok: true });
  }
  return bad('請提供 name 或 guild');
}

// PATCH：把既有成員改到某公會 { name, guild }
export async function onRequestPatch({ request, env, data }) {
  if (!isAdmin(data.user)) return deny();
  let b; try { b = await request.json(); } catch { return bad('JSON 格式錯誤'); }
  const name = clean(b.name);
  if (!name) return bad('缺少 name');
  let guild = b.guild != null ? clean(b.guild) : '';
  if (guild) {
    const exists = await env.DB.prepare('SELECT 1 FROM guilds WHERE name=?').bind(guild).first();
    if (!exists) return bad('公會不存在');
  } else {
    guild = null;
  }
  const r = await env.DB.prepare('UPDATE members SET guild=? WHERE name=?').bind(guild, name).run();
  if (!r.meta?.changes) return bad('找不到該成員', 404);
  return Response.json({ ok: true });
}
