// 站点访问凭证（httpOnly cookie）
// 用人话讲：以前登录后，凭证（就是访问密码的哈希）存在浏览器 localStorage 里，
// 页面上的 JS 想读就能读到；现在改成 httpOnly cookie——浏览器替你保管、每次请求
// 自动带上，但页面上的 JS 读不到，就算页面里混进恶意脚本也偷不走。
// 迁移：老会话本地还留着 token，中间件认 cookie 也认 x-site-token 头；
// 鉴权成功时服务端顺手把 cookie 种下，前端拿到一次成功响应就清掉本地旧 token。
// SameSite=Lax：从站外链接点进来仍保持登录，跨站 POST 不带 cookie（防 CSRF）。
// Secure 只在生产开（本地 http 开发也要能用）；有效期 365 天，和以前常驻登录一致。

const SITE_COOKIE = 'linverse_site_token';

// 从请求里读站点凭证：httpOnly cookie 优先，x-site-token 头兼容（老会话迁移期）
function readSiteToken(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SITE_COOKIE) {
      try { return decodeURIComponent(rest.join('=')); } catch { return rest.join('='); }
    }
  }
  const h = req.headers['x-site-token'];
  return typeof h === 'string' ? h : '';
}

// 登录成功后把凭证种成 httpOnly cookie
function setSiteCookie(res, token) {
  res.cookie(SITE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 24 * 3600 * 1000,
  });
}

// 退出/作废时清掉 cookie（改密码后旧 cookie 本来就会因哈希变了而失效，这里是顺手清干净）
function clearSiteCookie(res) {
  res.cookie(SITE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

module.exports = { SITE_COOKIE, readSiteToken, setSiteCookie, clearSiteCookie };
// 导出纯函数供自动化测试
module.exports._test = { readSiteToken };
