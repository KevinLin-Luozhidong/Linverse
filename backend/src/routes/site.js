// 全站访问密码：GET /api/site/status、POST /api/site/verify、POST /api/site/password
//
// 用人话讲：这是网站大门的"密码锁"。主人（用户）在 App 设置页里定一个密码，
// 之后任何人打开网址都要先输对密码才能用。后端只存密码的 SHA256（单向算出来的
// 一串字符，反推不出原密码），就算有人看到数据库也拿不到密码原文。
// token 就是这串哈希本身：前端验证通过后存下来，每次请求带在 x-site-token 头里，
// 后端比对一致就放行。改密码后旧 token 自动失效，不用维护 token 表。
const express = require('express');
const crypto = require('crypto');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();
const HASH_KEY = 'site_password_hash';
// 所有者密码：只有用户本人知道，专管"清空所有数据"这种危险操作。
// 访问密码是发给朋友的"大门钥匙"，所有者密码是只属于本人的"保险柜钥匙"。
const DANGER_KEY = 'danger_password_hash';
// 新账号注册开关：'1'=允许新设备自动建账号（默认），'0'=关闭。
// 用户不想走登录系统、又不想让拿到网址的人随便建账号时，关掉它。
// 关掉后新设备打不开 App，只看到"站长未开放注册"；已建好的账号不受影响。
const ALLOW_SIGNUP_KEY = 'allow_signup';
const OWNER_SESSION_KEY = 'owner_session_hash';
const OWNER_SESSION_EXPIRES_KEY = 'owner_session_expires';
const OWNER_VERIFY_FAILS_KEY = 'owner_verify_failures';
const OWNER_VERIFY_LOCK_KEY = 'owner_verify_lock_until';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// 密码 → 哈希：scrypt 慢哈希（每次随机盐），暴力破解成本比 SHA256 高几个数量级。
// 存法：scrypt:<盐hex>:<哈希hex>
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
// 老格式兼容：SHA256('linverse-site:' + pw)。验证通过后自动升级为 scrypt。
function legacyHashPw(pw) {
  return crypto.createHash('sha256').update('linverse-site:' + pw).digest('hex');
}
function isLegacyHash(stored) {
  return typeof stored === 'string' && !stored.startsWith('scrypt:');
}
// 定长比较，防时序攻击（长度不等直接 false，避免 timingSafeEqual 抛错）
function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return ba.length > 0 && ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
// 通用定长比较（token 这类非 hex 字符串用这个）
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length > 0 && ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function verifyPw(pw, stored) {
  if (!pw || !stored) return false;
  try {
    if (isLegacyHash(stored)) return safeEqualHex(legacyHashPw(pw), stored);
    const parts = String(stored).split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const h = crypto.scryptSync(pw, parts[1], 64).toString('hex');
    return safeEqualHex(h, parts[2]);
  } catch (e) { return false; }
}
// 客户端 IP：Vercel 把真实 IP 放在 x-forwarded-for 第一位
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 45);
  return String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').slice(0, 45);
}
// /verify 限流：同一 IP 5 分钟内失败 5 次，锁 15 分钟（记在 site_config，无需新表）
async function verifyLocked(req, res) {
  const ip = clientIp(req);
  const lockUntil = Number(await dao.getSiteConfig(`site_verify_lock_${ip}`) || 0);
  if (lockUntil > Date.now()) {
    res.status(429).json({ error: 'verify_locked', message: '密码试错太多次，请 15 分钟后再试' });
    return true;
  }
  return false;
}
async function recordVerifyFail(req) {
  const ip = clientIp(req);
  const fails = Number(await dao.getSiteConfig(`site_verify_fail_${ip}`) || 0) + 1;
  if (fails >= 5) {
    await dao.setSiteConfig(`site_verify_fail_${ip}`, '0');
    await dao.setSiteConfig(`site_verify_lock_${ip}`, String(Date.now() + 15 * 60 * 1000));
  } else {
    await dao.setSiteConfig(`site_verify_fail_${ip}`, String(fails));
  }
}
async function clearVerifyFails(req) {
  const ip = clientIp(req);
  await dao.setSiteConfig(`site_verify_fail_${ip}`, '0');
  await dao.setSiteConfig(`site_verify_lock_${ip}`, '0');
}

// 状态：有没有设密码（公开接口，密码门页面靠它决定展不展示输入框）
router.get('/status', ah(async (req, res) => {
  const h = await dao.getSiteConfig(HASH_KEY);
  res.json({ passwordSet: !!h });
}));

// 验证：输对密码拿 token（token 就是存的哈希本身，改密码后旧 token 自动失效）
router.post('/verify', ah(async (req, res) => {
  const h = await dao.getSiteConfig(HASH_KEY);
  if (!h) return res.json({ ok: true, token: '' }); // 没设密码：直接放行
  if (await verifyLocked(req, res)) return;
  const pw = (req.body.password || '').trim();
  if (need(res, pw, '请输入密码')) return;
  if (!verifyPw(pw, h)) {
    await recordVerifyFail(req);
    return res.status(401).json({ error: '密码不对，再试一次' });
  }
  await clearVerifyFails(req);
  // 老哈希验证通过：静默升级为 scrypt（旧 token 随之失效，需重新验证一次）
  if (isLegacyHash(h)) {
    const nh = hashPw(pw);
    await dao.setSiteConfig(HASH_KEY, nh);
    return res.json({ ok: true, token: nh });
  }
  res.json({ ok: true, token: h });
}));

// 设置/修改：第一次直接设（库里没有）；之后必须带对旧密码
router.post('/password', ah(async (req, res) => {
  const pw = (req.body.password || '').trim();
  if (need(res, pw && pw.length >= 4, '密码至少 4 位')) return;
  if (need(res, pw.length <= 64, '密码太长了')) return;
  const old = await dao.getSiteConfig(HASH_KEY);
  if (old) {
    const oldPw = (req.body.oldPassword || '').trim();
    if (need(res, oldPw, '请输入旧密码')) return;
    if (!verifyPw(oldPw, old)) return res.status(401).json({ error: '旧密码不对' });
  }
  const h = hashPw(pw);
  await dao.setSiteConfig(HASH_KEY, h);
  // 访问密码变化后，撤销已有所有者管理会话，要求重新验证。
  await dao.setSiteConfig(OWNER_SESSION_KEY, '');
  await dao.setSiteConfig(OWNER_SESSION_EXPIRES_KEY, '0');
  res.json({ ok: true, token: h });
}));

// 所有者密码：设置/修改。第一次直接设；之后必须带对旧的所有者密码。
// 这个密码只属于用户本人，朋友知道访问密码也清空不了数据。
router.post('/danger-password', ah(async (req, res) => {
  const siteHash = await dao.getSiteConfig(HASH_KEY);
  if (!siteHash) return res.status(403).json({ error: 'site_password_required', message: '请先设置访问密码，再设置所有者密码' });
  if (!safeEqual(req.headers['x-site-token'], siteHash)) {
    return res.status(401).json({ error: 'need_site_password', message: '请先验证访问密码' });
  }
  const pw = (req.body.password || '').trim();
  if (need(res, pw && pw.length >= 4, '密码至少 4 位')) return;
  if (need(res, pw.length <= 64, '密码太长了')) return;
  const old = await dao.getSiteConfig(DANGER_KEY);
  if (old) {
    const oldPw = (req.body.oldPassword || '').trim();
    if (need(res, oldPw, '请输入旧的所有者密码')) return;
    if (!verifyPw(oldPw, old)) return res.status(401).json({ error: '旧的所有者密码不对' });
  }
  await dao.setSiteConfig(DANGER_KEY, hashPw(pw));
  // 所有者密码变更后，撤销旧的管理会话。
  await dao.setSiteConfig(OWNER_SESSION_KEY, '');
  await dao.setSiteConfig(OWNER_SESSION_EXPIRES_KEY, '0');
  res.json({ ok: true });
}));

// 状态：有没有设所有者密码（前端危险区靠它决定展示"设置"还是"输入"）
router.get('/danger-status', ah(async (req, res) => {
  const h = await dao.getSiteConfig(DANGER_KEY);
  res.json({ dangerSet: !!h });
}));

// 验证所有者密码，签发 30 分钟有效的随机管理会话令牌。
router.post('/owner-verify', ah(async (req, res) => {
  const siteHash = await dao.getSiteConfig(HASH_KEY);
  if (!siteHash) return res.status(403).json({ error: 'site_password_required', message: '请先设置访问密码' });
  if (!safeEqual(req.headers['x-site-token'], siteHash)) {
    return res.status(401).json({ error: 'need_site_password', message: '请先验证访问密码' });
  }
  const lockUntil = Number(await dao.getSiteConfig(OWNER_VERIFY_LOCK_KEY) || 0);
  if (lockUntil > Date.now()) {
    return res.status(429).json({ error: 'owner_verify_locked', message: '所有者验证失败次数过多，请 15 分钟后重试' });
  }
  const stored = await dao.getSiteConfig(DANGER_KEY);
  if (!stored) return res.status(403).json({ error: 'owner_password_not_set', message: '请先设置所有者密码' });
  const password = (req.body.password || '').trim();
  if (!password || !verifyPw(password, stored)) {
    const failures = Number(await dao.getSiteConfig(OWNER_VERIFY_FAILS_KEY) || 0) + 1;
    if (failures >= 5) {
      await dao.setSiteConfig(OWNER_VERIFY_FAILS_KEY, '0');
      await dao.setSiteConfig(OWNER_VERIFY_LOCK_KEY, String(Date.now() + 15 * 60 * 1000));
      return res.status(429).json({ error: 'owner_verify_locked', message: '连续验证失败 5 次，请 15 分钟后重试' });
    }
    await dao.setSiteConfig(OWNER_VERIFY_FAILS_KEY, String(failures));
    return res.status(401).json({ error: 'owner_password_invalid', message: '所有者密码不正确' });
  }
  await dao.setSiteConfig(OWNER_VERIFY_FAILS_KEY, '0');
  await dao.setSiteConfig(OWNER_VERIFY_LOCK_KEY, '0');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 60 * 1000;
  await dao.setSiteConfig(OWNER_SESSION_KEY, hashToken(token));
  await dao.setSiteConfig(OWNER_SESSION_EXPIRES_KEY, String(expiresAt));
  res.json({ ok: true, token, expiresAt });
}));

// 清空所有数据（恢复出厂设置）：账号、错题、笔记、生词、会话全删，ID 从 1 重来。
// 四重保护：必须已设访问密码 + 请求头带对 token + 所有者密码 + body 二次确认，缺一个都不执行。
// 注意 need() 的语义：验证失败时返回 true（已回 400），所以用 if (need(...)) return
router.post('/reset', ah(async (req, res) => {
  const h = await dao.getSiteConfig(HASH_KEY);
  if (need(res, h, '还没设访问密码，不能清空')) return;
  if (need(res, req.headers['x-site-token'] === h, '访问密码不对')) return;
  const dh = await dao.getSiteConfig(DANGER_KEY);
  if (need(res, dh, '还没设所有者密码，不能清空（去设置 → 访问密码里设置）')) return;
  const danger = (req.body.danger || '').trim();
  if (need(res, danger && verifyPw(danger, dh), '所有者密码不对：只有本人能清空数据')) return;
  if (need(res, req.body.confirm === 'RESET', '请二次确认')) return;
  await dao.resetAll();
  await dao.setSiteConfig(OWNER_SESSION_KEY, '');
  await dao.setSiteConfig(OWNER_SESSION_EXPIRES_KEY, '0');
  res.json({ ok: true });
}));

// 新账号注册开关：是否允许新设备自动建账号
// 公开接口：新设备靠它决定展示 App 还是"站长未开放注册"
// 默认允许（库里没这个键时），用户关掉后才拒绝
router.get('/signup-status', ah(async (req, res) => {
  const v = await dao.getSiteConfig(ALLOW_SIGNUP_KEY);
  res.json({ allow: v !== '0' });
}));

// 改开关：只有所有者密码能改（朋友知道访问密码也改不了）
router.post('/signup-allow', ah(async (req, res) => {
  const dh = await dao.getSiteConfig(DANGER_KEY);
  if (need(res, dh, '请先去设置 → 访问密码里设置所有者密码')) return;
  const pw = (req.body.dangerPassword || '').trim();
  if (need(res, pw && verifyPw(pw, dh), '所有者密码不对：只有本人能改这个开关')) return;
  const allow = req.body.allow === true;
  await dao.setSiteConfig(ALLOW_SIGNUP_KEY, allow ? '1' : '0');
  res.json({ ok: true, allow });
}));

module.exports = router;
