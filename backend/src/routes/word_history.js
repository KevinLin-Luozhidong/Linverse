// 查词历史：GET /api/word-history?profileId=
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(dao.listWordHistory(req.query.profileId));
}));

module.exports = router;
