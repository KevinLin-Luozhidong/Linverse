// 每日早报：全站公共只读内容，不分账号。
// GET /api/briefings        → 最新一期（没有数据返回 null）
// GET /api/briefings/:date  → 指定日期一期（YYYY-MM-DD，查不到返回 null）
// 鉴权不用这里管：app.js 的全局中间件（站点密码 + 账号凭证）已经挡过一层。
const express = require('express');
const dao = require('../db/dao');
const { ah } = require('./helpers');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  // 早报一天一期：浏览器可缓存 10 分钟，助手页挂载和早报子页就不用各查一次
  res.set('Cache-Control', 'private, max-age=600');
  res.json(await dao.getLatestBriefing());
}));

router.get('/:date', ah(async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '日期格式不对，应为 YYYY-MM-DD' });
  }
  res.json(await dao.getBriefingByDate(date));
}));

module.exports = router;
