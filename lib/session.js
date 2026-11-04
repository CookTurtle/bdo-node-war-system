// 以 HMAC-SHA256 簽名的 session token（無需額外套件）
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export async function makeToken(payload, secret) {
  const body = btoa(JSON.stringify(payload));
  return body + '.' + await hmac(body, secret);
}
export async function readToken(token, secret) {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig || sig !== await hmac(body, secret)) return null;
  const p = JSON.parse(atob(body));
  return p.exp > Date.now() ? p : null;
}
export function cookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m && m[1];
}
export async function getUser(request, env) {
  const p = await readToken(cookie(request, 'session'), env.SESSION_SECRET);
  return p ? env.DB.prepare('SELECT * FROM users WHERE discord_id=?').bind(p.id).first() : null;
}
