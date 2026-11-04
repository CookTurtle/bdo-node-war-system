// /api/auth/login | callback | logout | me | sync-role
import { makeToken, cookie, getUser } from '../../../lib/session.js';

// ========== 可直接在這裡改（也可用環境變數覆蓋）==========
// Discord 伺服器 ID
const CONFIG_GUILD_ID = '';
// 可登入查詢的身份組 ID（可多個）
const CONFIG_ROLE_IDS = [
  // '1432384561945247861',
  // '1475494482706170059',
];
// 同步時是否移除已沒有身份組的普通成員（不影響 admin）
const CONFIG_PRUNE = true;
// ========================================================

const text = (s, status) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const json = (o, status = 200) => Response.json(o, { status });

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url), redirect = url.origin + '/api/auth/callback';
  switch (params.action) {
    case 'login': {
      const state = crypto.randomUUID();
      const q = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirect,
        response_type: 'code', scope: 'identify', state,
      });
      return new Response(null, { status: 302, headers: {
        Location: 'https://discord.com/oauth2/authorize?' + q,
        'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      } });
    }
    case 'callback': {
      if (!url.searchParams.get('state') || url.searchParams.get('state') !== cookie(request, 'oauth_state'))
        return text('state 驗證失敗，請重新登入', 400);
      const tok = await (await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirect,
        }),
      })).json();
      if (!tok.access_token) return text('Discord 授權失敗', 400);
      const me = await (await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: 'Bearer ' + tok.access_token },
      })).json();
      const row = await env.DB.prepare('SELECT discord_id, role, name FROM users WHERE discord_id=?').bind(me.id).first();
      if (!row) return text(`此 Discord 帳號尚未被授權。若你已有公會身份組，請請管理員到「成員名單」頁按同步。你的 ID：${me.id}`, 403);
      const display = me.global_name || me.username || row.name || me.id;
      if (display && display !== row.name)
        await env.DB.prepare('UPDATE users SET name=? WHERE discord_id=?').bind(display, me.id).run();
      const t = await makeToken({ id: me.id, exp: Date.now() + 7 * 864e5 }, env.SESSION_SECRET);
      const dest = row.role === 'admin' ? '/upload.html' : '/';
      return new Response(null, { status: 302, headers: {
        Location: dest,
        'Set-Cookie': `session=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
      } });
    }
    case 'logout':
      return new Response(null, { status: 302, headers: {
        Location: '/', 'Set-Cookie': 'session=; Path=/; Max-Age=0',
      } });
    case 'me': {
      const u = await getUser(request, env);
      return Response.json(u ? { id: u.discord_id, name: u.name, role: u.role } : null);
    }
  }
  return text('not found', 404);
}

// POST /api/auth/sync-role
// 兩種授權：1) 管理員已登入（網頁按鈕） 2) Authorization: Bearer SYNC_SECRET（外部排程）
// body 可選：{ prune?: boolean, members?: [{id,name}] }
export async function onRequestPost({ request, env, params }) {
  if (params.action !== 'sync-role') return text('not found', 404);

  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await getUser(request, env);
  const okSecret = env.SYNC_SECRET && bearer && bearer === env.SYNC_SECRET;
  const okAdmin = user && user.role === 'admin';
  if (!okSecret && !okAdmin) return json({ error: '未授權（請用管理員登入後從網頁觸發，或帶正確 SYNC_SECRET）' }, 401);

  let members = [];
  let prune = CONFIG_PRUNE;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    let b = {};
    try { b = await request.json(); } catch { /* empty ok */ }
    if (Array.isArray(b.members)) members = b.members;
    if (typeof b.prune === 'boolean') prune = b.prune;
  }

  if (!members.length) {
    if (!env.DISCORD_BOT_TOKEN) {
      return json({ error: '尚未設定 DISCORD_BOT_TOKEN（請用 wrangler pages secret put）' }, 500);
    }
    try {
      members = await fetchRoleMembers(env);
    } catch (e) {
      return json({ error: '向 Discord 拉取成員失敗：' + (e.message || e) }, 502);
    }
  }
  if (!members.length) {
    return json({
      error: '沒有可同步的成員。請檢查：Bot 已進服、SERVER MEMBERS INTENT 已開、原始碼/環境變數的公會 ID 與身份組 ID 是否正確。',
    }, 400);
  }

  const seen = new Set();
  const stmts = [];
  for (const m of members) {
    const id = String(m.id || m.discord_id || '').trim();
    if (!id || !/^\d{5,30}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = String(m.name || m.username || id).slice(0, 64);
    stmts.push(env.DB.prepare(
      `INSERT INTO users(discord_id, name, role) VALUES(?,?, 'member')
       ON CONFLICT(discord_id) DO UPDATE SET
         name = CASE WHEN excluded.name != '' AND (users.name IS NULL OR users.name = '') THEN excluded.name ELSE users.name END`
    ).bind(id, name));
  }
  if (!stmts.length) return json({ error: '沒有有效的 Discord ID' }, 400);

  let added = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await env.DB.batch(stmts.slice(i, i + 50));
    added += res.reduce((s, r) => s + (r.meta?.changes || 0), 0);
  }

  let removed = 0;
  if (prune && seen.size) {
    const all = (await env.DB.prepare(`SELECT discord_id FROM users WHERE role IS NULL OR role != 'admin'`).all()).results || [];
    const toRemove = all.map(r => r.discord_id).filter(id => !seen.has(id));
    for (let i = 0; i < toRemove.length; i += 50) {
      const chunk = toRemove.slice(i, i + 50);
      const ph = chunk.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `DELETE FROM users WHERE discord_id IN (${ph}) AND (role IS NULL OR role != 'admin')`
      ).bind(...chunk).run();
      removed += r.meta?.changes || 0;
    }
  }

  return json({ ok: true, synced: seen.size, upsert_changes: added, removed, prune });
}

function resolveGuildId(env) {
  return String(env.DISCORD_GUILD_ID || CONFIG_GUILD_ID || '').trim();
}
function resolveRoleIds(env) {
  const fromEnv = String(env.DISCORD_MEMBER_ROLE_ID || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return (CONFIG_ROLE_IDS || []).map(String).map(s => s.trim()).filter(Boolean);
}

async function fetchRoleMembers(env) {
  const guildId = resolveGuildId(env);
  const roleIds = resolveRoleIds(env);
  if (!guildId) throw new Error('未設定公會 ID（原始碼 CONFIG_GUILD_ID 或環境變數 DISCORD_GUILD_ID）');
  if (!roleIds.length) throw new Error('未設定身份組 ID（原始碼 CONFIG_ROLE_IDS 或環境變數 DISCORD_MEMBER_ROLE_ID）');

  const out = [];
  const seen = new Set();
  let after = '0';
  for (let page = 0; page < 50; page++) {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`,
      { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Discord API ${res.status} ${body.slice(0, 200)}`);
    }
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) break;
    for (const m of list) {
      if (m.user?.bot) continue;
      const roles = m.roles || [];
      if (!roleIds.some(id => roles.includes(id))) continue;
      const id = m.user.id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: m.nick || m.user.global_name || m.user.username || id,
      });
    }
    after = list[list.length - 1].user.id;
    if (list.length < 1000) break;
  }
  return out;
}
