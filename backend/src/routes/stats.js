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

// 个人中心统计：7 个查询互不依赖，并行跑（以前是串行等 7 轮）
router.get('/stats', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const { profileId } = req.query;
  const [streakDays, checkinDays, recentCheckins, mistakeCount, masteredMistakeCount, noteCount, wordCount] = await Promise.all([
    dao.streakDays(profileId),      // 连续打卡天数
    dao.countCheckinDays(profileId), // 累计打卡天数
    dao.recentCheckinDates(profileId, 7), // 最近7天打卡日期（YYYY-MM-DD）
    dao.countMistakes(profileId),   // 错题数
    dao.countMasteredMistakes(profileId), // 已掌握错题数（个人中心“已掌握 x/y”用，不再全量拉列表）
    dao.countNotes(profileId),         // 笔记数
    dao.countWords(profileId),          // 生词数
  ]);
  res.json({ streakDays, checkinDays, recentCheckins, mistakeCount, masteredMistakeCount, noteCount, wordCount });
}));

// 徽章：按统计数据判断解锁状态（两个查询互不依赖，并行跑）
router.get('/badges', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  const { profileId } = req.query;
  const [mistakeCount, streak] = await Promise.all([
    dao.countMistakes(profileId),
    dao.streakDays(profileId),
  ]);
  res.json([
    { id: 'first-mistake', name: '第一道错题', desc: '记录第一道错题', unlocked: mistakeCount >= 1 },
    { id: 'streak-3', name: '坚持三天', desc: '连续打卡 3 天', unlocked: streak >= 3 },
    { id: 'streak-7', name: '一周不辍', desc: '连续打卡 7 天', unlocked: streak >= 7 },
    { id: 'mistake-50', name: '百题斩', desc: '累计记录 50 道错题', unlocked: mistakeCount >= 50 },
  ]);
}));

module.exports = router;
