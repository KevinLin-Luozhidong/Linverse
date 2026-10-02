// 对话管理：对话列表 / 详情（含消息） / 新建 / 删除
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 某账号的对话列表（按 profileId 隔离）
router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(dao.listConversations(req.query.profileId));
}));

// 新建对话（POST /api/conversations）
router.post('/', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  res.status(201).json(dao.createConversation(req.body.profileId, req.body.title));
}));

// 对话详情，带全部消息
router.get('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const conv = dao.getConversation(req.params.id, req.query.profileId);
  if (!conv) return res.status(404).json({ error: '对话不存在' });
  res.json(conv);
}));

// 删除对话（连带删除消息：外键 CASCADE）
router.delete('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const n = dao.deleteConversation(req.params.id, req.query.profileId);
  if (!n) return res.status(404).json({ error: '对话不存在' });
  res.json({ ok: true });
}));

module.exports = router;
