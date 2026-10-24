// 对话管理：对话列表 / 详情（含消息） / 新建 / 删除
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 某账号的对话列表（按 profileId 隔离）
router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(await dao.listConversations(req.query.profileId));
}));

// 新建对话（POST /api/conversations）
router.post('/', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  res.status(201).json(await dao.createConversation(req.body.profileId, req.body.title));
}));

// 对话详情，带全部消息
router.get('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const conv = await dao.getConversation(req.params.id, req.query.profileId);
  if (!conv) return res.status(404).json({ error: '对话不存在' });
  res.json(conv);
}));

// 删除对话（连带删除消息：外键 CASCADE）
router.delete('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const n = await dao.deleteConversation(req.params.id, req.query.profileId);
  if (!n) return res.status(404).json({ error: '对话不存在' });
  res.json({ ok: true });
}));

// 批量删除对话（POST /api/conversations/batch-delete，body: { profileId, ids: [] }）
// 注意：必须放在 '/:id' 之后无冲突——POST 与 DELETE 方法不同，且路径是固定段 batch-delete
router.post('/batch-delete', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  const ids = req.body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) {
    return res.status(400).json({ error: 'ids 须为 1~200 个会话 id' });
  }
  const n = await dao.deleteConversations(ids, req.body.profileId);
  res.json({ ok: true, deleted: n });
}));

// 收藏 / 取消收藏对话（PATCH /api/conversations/:id/favorite，body: { profileId, favorite }）
router.patch('/:id/favorite', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  const conv = await dao.setConversationFavorite(req.params.id, req.body.profileId, req.body.favorite);
  if (!conv) return res.status(404).json({ error: '对话不存在' });
  res.json(conv);
}));

module.exports = router;
