// 账号管理：GET /api/profiles、POST /api/profiles、PUT/DELETE /api/profiles/:id
const express = require('express');
const crypto = require('crypto');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 只返回当前已认证账号，绝不枚举其他账号。
router.get('/', ah(async (req, res) => {
  res.json(await dao.listProfiles(req.profileId));
}));

// 新建账号
router.post('/', ah(async (req, res) => {
  // 注册总闸：站长关掉后，新设备不能再自动建账号（已建好的账号不受影响）
  const allow = await dao.getSiteConfig('allow_signup');
  if (allow === '0') {
    return res.status(403).json({ error: '站长暂未开放新账号注册' });
  }
  if (need(res, req.body.name && req.body.name.trim(), 'name 不能为空')) return;
  const authToken = crypto.randomBytes(32).toString('hex');
  const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
  const profile = await dao.createProfile(req.body.name.trim(), authTokenHash);
  res.status(201).json({ ...profile, authToken });
}));

// 旧账号迁移：必须先设置全站访问密码并通过验证，再给未绑定凭证的旧账号绑定一次新凭证。
// 避免在公开站点上仅凭可猜测的数字 ID 抢先认领旧账号。
router.post('/:id/claim', ah(async (req, res) => {
  const siteHash = await dao.getSiteConfig('site_password_hash');
  if (!siteHash) {
    return res.status(403).json({ error: 'legacy_claim_requires_site_password', message: '迁移旧账号前，请先设置访问密码，再重新打开应用' });
  }
  if (req.headers['x-site-token'] !== siteHash) {
    return res.status(401).json({ error: 'need_site_password', message: '请先验证访问密码' });
  }
  const id = req.params.id;
  const existingHash = await dao.getProfileAuthHash(id);
  if (existingHash) return res.status(409).json({ error: '该账号已绑定认证凭证，不能重新认领' });
  const authToken = crypto.randomBytes(32).toString('hex');
  const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
  const profile = await dao.claimProfile(id, authTokenHash);
  if (!profile) return res.status(409).json({ error: '账号迁移冲突，请刷新后重试' });
  res.json({ ...profile, authToken });
}));

// 改名
router.put('/:id', ah(async (req, res) => {
  if (need(res, req.body.name && req.body.name.trim(), 'name 不能为空')) return;
  const p = await dao.updateProfile(req.params.id, req.body.name.trim());
  if (!p) return res.status(404).json({ error: '账号不存在' });
  res.json(p);
}));

// 换头像：body { avatarUrl }
router.put('/:id/avatar', ah(async (req, res) => {
  if (need(res, req.body.avatarUrl, 'avatarUrl 不能为空')) return;
  const p = await dao.setAvatar(req.params.id, req.body.avatarUrl);
  if (!p) return res.status(404).json({ error: '账号不存在' });
  res.json(p);
}));

// 删除账号（连带删除该账号所有数据：外键 CASCADE）
router.delete('/:id', ah(async (req, res) => {
  const n = await dao.deleteProfile(req.params.id);
  if (!n) return res.status(404).json({ error: '账号不存在' });
  res.json({ ok: true });
}));

module.exports = router;
