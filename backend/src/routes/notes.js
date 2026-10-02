// 笔记本：GET/POST /api/notes，PUT/DELETE /api/notes/:id
// 支持搜索 q、按标签 tag 筛选、按归档状态 archived 筛选
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 笔记列表：?profileId=&q=&tag=&archived=
router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const { q, tag, archived } = req.query;
  res.json(dao.listNotes(req.query.profileId, { q, tag, archived }));
}));

// 新建笔记（images/tags 传数组，后端存成 JSON）
router.post('/', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  res.status(201).json(dao.createNote(req.body));
}));

// 修改笔记（局部更新）
router.put('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId || req.body.profileId, 'profileId 必填')) return;
  const profileId = req.query.profileId || req.body.profileId;
  const n = dao.updateNote(req.params.id, profileId, req.body);
  if (!n) return res.status(404).json({ error: '笔记不存在' });
  res.json(n);
}));

// 删除笔记
router.delete('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId || req.body.profileId, 'profileId 必填')) return;
  const profileId = req.query.profileId || req.body.profileId;
  const n = dao.deleteNote(req.params.id, profileId);
  if (!n) return res.status(404).json({ error: '笔记不存在' });
  res.json({ ok: true });
}));

module.exports = router;
