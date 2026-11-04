// 職業圖示模板（32x32 灰階，1024 個 0-255 整數）。上傳者修正職業時由前端自動回存，模板會越用越準。
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT class_id, vec FROM icon_templates').all();
  return Response.json(results.map(r => ({ class_id: r.class_id, vec: JSON.parse(r.vec) })));
}
export async function onRequestPost({ request, env, data }) {
  let b; try { b = await request.json(); } catch { return Response.json({ error: 'JSON 格式錯誤' }, { status: 400 }); }
  const { class_id, vec } = b;
  if (typeof class_id !== 'string' || !class_id || class_id.length > 30 || !Array.isArray(vec) || vec.length !== 1024
    || vec.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return Response.json({ error: '模板格式不正確' }, { status: 400 });
  const n = (await env.DB.prepare('SELECT COUNT(*) c FROM icon_templates WHERE class_id=?').bind(class_id).first()).c;
  if (n >= 8) return Response.json({ error: '此職業的模板已足夠' }, { status: 409 });
  await env.DB.prepare('INSERT INTO icon_templates(class_id,vec,created_by) VALUES(?,?,?)')
    .bind(class_id, JSON.stringify(vec), data.user.discord_id).run();
  return Response.json({ ok: true });
}
