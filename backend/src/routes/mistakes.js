// 错题本：GET/POST /api/mistakes，PUT/DELETE /api/mistakes/:id
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 错题列表，可按科目筛选：?profileId=&subject=
router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(await dao.listMistakes(req.query.profileId, req.query.subject || ''));
}));

// 新增错题
router.post('/', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  res.status(201).json(await dao.createMistake(req.body));
}));

// 修改错题（支持局部更新：只传要改的字段）
router.put('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId || req.body.profileId, 'profileId 必填')) return;
  const profileId = req.query.profileId || req.body.profileId;
  const m = await dao.updateMistake(req.params.id, profileId, req.body);
  if (!m) return res.status(404).json({ error: '错题不存在' });
  res.json(m);
}));

// 删除错题
router.delete('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId || req.body.profileId, 'profileId 必填')) return;
  const profileId = req.query.profileId || req.body.profileId;
  const n = await dao.deleteMistake(req.params.id, profileId);
  if (!n) return res.status(404).json({ error: '错题不存在' });
  res.json({ ok: true });
}));

module.exports = router;
