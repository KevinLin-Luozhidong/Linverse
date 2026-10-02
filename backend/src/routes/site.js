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

// 密码 → 哈希：固定加一段应用前缀再算 SHA256，避免和其它地方的哈希撞车
function hashPw(pw) {
  return crypto.createHash('sha256').update('linverse-site:' + pw).digest('hex');
}

// 状态：有没有设密码（公开接口，密码门页面靠它决定展不展示输入框）
router.get('/status', ah(async (req, res) => {
  const h = await dao.getSiteConfig(HASH_KEY);
  res.json({ passwordSet: !!h });
}));

// 验证：输对密码拿 token
router.post('/verify', ah(async (req, res) => {
  const h = await dao.getSiteConfig(HASH_KEY);
  if (!h) return res.json({ ok: true, token: '' }); // 没设密码：直接放行
  const pw = (req.body.password || '').trim();
  if (need(res, pw, '请输入密码')) return;
  if (hashPw(pw) !== h) return res.status(401).json({ error: '密码不对，再试一次' });
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
    if (hashPw(oldPw) !== old) return res.status(401).json({ error: '旧密码不对' });
  }
  const h = hashPw(pw);
  await dao.setSiteConfig(HASH_KEY, h);
  res.json({ ok: true, token: h });
}));

// 清空所有数据（恢复出厂设置）：账号、错题、笔记、生词、会话全删，ID 从 1 重来。
// 三重保护：必须已设访问密码 + 请求头带对 token + body 二次确认，缺一个都不执行。
// 注意 need() 的语义：验证失败时返回 true（已回 400），所以用 if (need(...)) return
router.post('/reset', ah(async (req, res) => {
  const h = await dao.getSiteConfig(HASH_KEY);
  if (need(res, h, '还没设访问密码，不能清空')) return;
  if (need(res, req.headers['x-site-token'] === h, '访问密码不对')) return;
  if (need(res, req.body.confirm === 'RESET', '请二次确认')) return;
  await dao.resetAll();
  res.json({ ok: true });
}));

module.exports = router;
