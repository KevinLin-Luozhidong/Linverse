// 设置：GET /api/settings?profileId=，PUT /api/settings
// settings 表一个账号只存一行，第一次读取自动创建默认值
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(await dao.getSettings(req.query.profileId));
}));

router.put('/', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  res.json(await dao.updateSettings(req.body.profileId, req.body));
}));

module.exports = router;
