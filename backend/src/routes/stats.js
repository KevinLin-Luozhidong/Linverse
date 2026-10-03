// 打卡 / 统计 / 徽章
// POST /api/checkin {profileId}
// GET  /api/stats?profileId=      → {streakDays,checkinDays,mistakeCount,noteCount,wordCount}
// GET  /api/badges?profileId=     → 4 枚 [{id,name,desc,unlocked}]
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 打卡：同一天重复打卡只记一次（数据库 UNIQUE 约束保证）
router.post('/checkin', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  const checkinDays = await dao.checkin(req.body.profileId);
  res.json({ ok: true, checkinDays, streakDays: await dao.streakDays(req.body.profileId) });
}));

// 个人中心统计
router.get('/stats', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const { profileId } = req.query;
  res.json({
    streakDays: await dao.streakDays(profileId),      // 连续打卡天数
    checkinDays: await dao.countCheckinDays(profileId), // 累计打卡天数
    recentCheckins: await dao.recentCheckinDates(profileId, 7), // 最近7天打卡日期（YYYY-MM-DD）
    mistakeCount: await dao.countMistakes(profileId),   // 错题数
    noteCount: await dao.countNotes(profileId),         // 笔记数
    wordCount: await dao.countWords(profileId),          // 生词数
  });
}));

// 徽章：按统计数据判断解锁状态
router.get('/badges', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const { profileId } = req.query;
  const mistakeCount = await dao.countMistakes(profileId);
  const streak = await dao.streakDays(profileId);
  res.json([
    { id: 'first-mistake', name: '第一道错题', desc: '记录第一道错题', unlocked: mistakeCount >= 1 },
    { id: 'streak-3', name: '坚持三天', desc: '连续打卡 3 天', unlocked: streak >= 3 },
    { id: 'streak-7', name: '一周不辍', desc: '连续打卡 7 天', unlocked: streak >= 7 },
    { id: 'mistake-50', name: '百题斩', desc: '累计记录 50 道错题', unlocked: mistakeCount >= 50 },
  ]);
}));

module.exports = router;
