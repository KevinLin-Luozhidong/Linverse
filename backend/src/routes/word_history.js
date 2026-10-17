// 查词历史：GET /api/word-history?profileId=  DELETE /api/word-history?profileId=（清空历史）
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(await dao.listWordHistory(req.query.profileId));
}));

// UX-8：清空该账号的全部查词历史
router.delete('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  await dao.clearWordHistory(req.query.profileId);
  res.json({ ok: true });
}));

module.exports = router;
