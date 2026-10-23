// 汕头看板：周末仪表盘，周六、周日各一期，全站公共只读内容，不分账号。
// GET /api/shantou        → 最新一期（没有数据返回 null）
// GET /api/shantou/:date  → 指定日期一期（YYYY-MM-DD，查不到返回 null）
// 两个路由都支持 ?region= 查询参数（缺省 'shantou'）；region 不在已知地区列表里时
// 返回 404 unknown_region，不查库、不崩，等该地区后端数据接入后再把 id 加进 KNOWN_REGIONS。
// 鉴权不用这里管：app.js 的全局中间件（站点密码 + 账号凭证）已经挡过一层。
const express = require('express');
const dao = require('../db/dao');
const { ah } = require('./helpers');

const router = express.Router();

// 已知地区（目前只有汕头接了真实数据；加地区时在这里注册 id 并让 dao 按地区取数）
const KNOWN_REGIONS = new Set(['shantou']);

// 取请求里的 region 参数，缺省回落 'shantou'
function getRegion(req) {
  return req.query.region || 'shantou';
}

router.get('/', ah(async (req, res) => {
  const region = getRegion(req);
  if (!KNOWN_REGIONS.has(region)) {
    return res.status(404).json({ error: 'unknown_region', message: '该地区看板即将上线' });
  }
  res.json(await dao.getLatestShantouBoard());
}));

router.get('/:date', ah(async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '日期格式不对，应为 YYYY-MM-DD' });
  }
  const region = getRegion(req);
  if (!KNOWN_REGIONS.has(region)) {
    return res.status(404).json({ error: 'unknown_region', message: '该地区看板即将上线' });
  }
  res.json(await dao.getShantouBoardByDate(date));
}));

module.exports = router;
