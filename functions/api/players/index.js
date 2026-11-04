// GET /api/players?q=前綴 → 名字建議；不帶 q → 全部名字（上傳頁做相似名比對用）
export async function onRequestGet({ env, request }) {
  const q = new URL(request.url).searchParams.get('q');
  const st = q
    ? env.DB.prepare('SELECT DISTINCT family_name n FROM player_stats WHERE family_name LIKE ? LIMIT 20').bind(q.replace(/[%_]/g, '') + '%')
    : env.DB.prepare('SELECT DISTINCT family_name n FROM player_stats LIMIT 5000');
  return Response.json((await st.all()).results.map(r => r.n));
}
