// Express 应用组装：中间件 + 静态托管 + 路由挂载 + 错误处理
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// 定长比较防时序攻击（token/哈希比对都走这里，不用 ===）
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length > 0 && ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// 跨域：生产环境默认只允许同源（前后端同域部署，浏览器同源请求不需要 CORS 头）；
// 如需开放给其他域名，设环境变量 CORS_ORIGINS=https://a.com,https://b.com。
// 开发环境保持宽松，方便本地联调。
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? (corsOrigins.length ? corsOrigins : false) : true }));
// 解析 JSON 请求体（问答、错题等接口都用 JSON）
app.use(express.json({ limit: '10mb' }));

// 注意：上传的图片现在直接存 Supabase Storage，返回的是 https 公开链接，
// 前端直接拿去显示，不再经过我们服务器，所以这里不需要静态托管 /uploads。
// （原来那行 express.static(…/uploads) 已删除：serverless 函数没有本地磁盘）

// 路由挂载（URL 和字段名按 API 契约，原样不动）
app.use('/api/site', require('./routes/site')); // 访问密码：status/verify/password 不设防

// 访问密码门：除了 site 相关和健康检查，其他 /api/* 都要校验 x-site-token。
// 没设密码 = 公开状态，直接放行；设了之后 token 对不上就 401，前端弹密码页。
// 注意：挂在各业务路由之前，顺序不能乱。
const dao = require('./db/dao');
app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/site/') || req.path === '/health') return next();
  try {
    const hash = await dao.getSiteConfig('site_password_hash');
    if (!hash) return next();
    const token = req.headers['x-site-token'];
    if (token && safeEqual(token, hash)) return next();
    return res.status(401).json({ error: 'need_site_password', message: '请输入访问密码' });
  } catch (e) {
    next(e);
  }
});

// 账号级身份认证：站点密码只负责进站，不能代替每个账号的所有权校验。
app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/site/') || req.path === '/health') return next();
  // 路径归一化：去掉末尾斜杠，避免 '/profiles/' 绕过下面的精确匹配
  const p = req.path.length > 1 && req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
  // 注册和旧账号首次迁移由各自路由处理；其余业务 API 必须有账号凭证。
  if (req.method === 'POST' && (p === '/profiles' || /^\/profiles\/[^/]+\/claim$/.test(p))) return next();
  const profileId = String(req.headers['x-profile-id'] || '');
  const token = String(req.headers['x-profile-token'] || '');
  if (!profileId || !token) {
    return res.status(401).json({ error: 'need_profile_auth', message: '请先验证账号' });
  }
  try {
    const storedHash = await dao.getProfileAuthHash(profileId);
    const suppliedHash = require('crypto').createHash('sha256').update(token).digest('hex');
    if (!storedHash || !safeEqual(storedHash, suppliedHash)) {
      return res.status(401).json({ error: 'need_profile_auth', message: '账号凭证无效，请重新验证账号' });
    }
    // 所有数据接口的 profileId 必须与凭证所属账号一致，禁止只改请求参数访问别人的数据。
    const requestedIds = [req.query.profileId, req.body && req.body.profileId]
      .filter((v) => v !== undefined && v !== null && String(v) !== '')
      .map(String);
    if (requestedIds.some((id) => id !== profileId)) {
      return res.status(403).json({ error: 'profile_forbidden', message: '不能访问其他账号的数据' });
    }
    if (p.startsWith('/profiles/')) {
      const targetId = p.split('/')[2];
      if (targetId && targetId !== 'claim' && targetId !== profileId) {
        return res.status(403).json({ error: 'profile_forbidden', message: '不能操作其他账号' });
      }
    }
    req.profileId = profileId;
    next();
  } catch (e) {
    next(e);
  }
});

// 知识库写入/删除属于管理员操作：除账号凭证外，还必须提供短期所有者会话。
app.use('/api', async (req, res, next) => {
  const adminAction =
    (req.method === 'POST' && (req.path === '/kb/ingest' || req.path === '/kb/faq/ingest')) ||
    (req.method === 'DELETE' && req.path === '/kb/books');
  if (!adminAction) return next();
  try {
    const expected = await dao.getSiteConfig('owner_session_hash');
    const expiresAt = Number(await dao.getSiteConfig('owner_session_expires'));
    const token = String(req.headers['x-owner-token'] || '');
    const supplied = require('crypto').createHash('sha256').update(token).digest('hex');
    if (!expected || !token || !safeEqual(expected, supplied) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return res.status(403).json({ error: 'need_owner_auth', message: '此操作需要先验证所有者密码（有效期 30 分钟）' });
    }
    next();
  } catch (e) {
    next(e);
  }
});

app.use('/api/profiles', require('./routes/profiles'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/mistakes', require('./routes/mistakes'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/vocabulary', require('./routes/vocabulary'));
app.use('/api/word-history', require('./routes/word_history'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api', require('./routes/stats')); // /api/checkin /api/stats /api/badges
app.use('/api', require('./routes/ai')); // /api/upload /api/ask /api/ocr /api/dictionary
app.use('/api/kb', require('./routes/kb')); // RAG 知识库：status/ingest/search（走全局 x-site-token 鉴权）
app.use('/api/briefings', require('./routes/briefings')); // 每日早报：全站公共只读（走全局鉴权，不分账号）
app.use('/api/shantou', require('./routes/shantou')); // 汕头看板：全站公共只读（走全局鉴权，不分账号）

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 404：未知 API 路径
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 统一错误处理：multer 的文件类型/大小错误、业务抛出的 Error 都转成 JSON
// 注意：错误信息只返回 message，不泄露堆栈
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.message && err.message.includes('只支持上传图片') ? 400 : 500;
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

module.exports = app;
