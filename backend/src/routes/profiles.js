// 账号管理：GET /api/profiles、POST /api/profiles、PUT/DELETE /api/profiles/:id
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 所有账号列表
router.get('/', ah(async (req, res) => {
  res.json(await dao.listProfiles());
}));

// 新建账号
router.post('/', ah(async (req, res) => {
  // 注册总闸：站长关掉后，新设备不能再自动建账号（已建好的账号不受影响）
  const allow = await dao.getSiteConfig('allow_signup');
  if (allow === '0') {
    return res.status(403).json({ error: '站长暂未开放新账号注册' });
  }
  if (need(res, req.body.name && req.body.name.trim(), 'name 不能为空')) return;
  res.status(201).json(await dao.createProfile(req.body.name.trim()));
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
