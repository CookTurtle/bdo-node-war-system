// 所有非 GET 請求（寫入）都必須是白名單內的已登入使用者；登入流程本身除外
import { getUser } from '../../lib/session.js';
export async function onRequest({ request, env, next, data }) {
  if (request.method !== 'GET' && !new URL(request.url).pathname.startsWith('/api/auth/')) {
    const user = await getUser(request, env);
    if (!user) return Response.json({ error: '請先登入，或帳號尚未被授權' }, { status: 401 });
    data.user = user;
  }
  return next();
}
