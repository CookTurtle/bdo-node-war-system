// GET /api/players/<家門名稱> → 該玩家最近 100 場
export async function onRequestGet({ env, params }) {
  let name = params.name; try { name = decodeURIComponent(name); } catch {}
  const { results } = await env.DB.prepare(`SELECT m.played_on,m.duration_sec,p.*
    FROM player_stats p JOIN matches m ON m.id=p.match_id WHERE p.family_name=?
    ORDER BY m.played_on DESC, m.id DESC LIMIT 100`).bind(name).all();
  return Response.json(results);
}
