// 生词本 + 查词历史
// 生词本：GET/POST /api/vocabulary，PUT /api/vocabulary/:id，POST /:id/review，GET /vocabulary/due
// 查词历史：GET /api/word-history
const express = require('express');
const dao = require('../db/dao');
const { ah, need } = require('./helpers');

const router = express.Router();

// 生词列表
router.get('/', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(await dao.listVocabulary(req.query.profileId));
}));

// 今天到期的词（nextReview <= 今天 且未掌握）
router.get('/due', ah(async (req, res) => {
  if (need(res, req.query.profileId, 'profileId 必填')) return;
  res.json(await dao.listDueVocabulary(req.query.profileId));
}));

// 添加生词
router.post('/', ah(async (req, res) => {
  if (need(res, req.body.profileId, 'profileId 必填')) return;
  if (need(res, req.body.word && req.body.word.trim(), 'word 不能为空')) return;
  res.status(201).json(await dao.createVocabulary({
    profileId: req.body.profileId,
    word: req.body.word.trim(),
    phonetic: req.body.phonetic,
    meaning: req.body.meaning,
  }));
}));

// 标记掌握 / 取消掌握
router.put('/:id', ah(async (req, res) => {
  if (need(res, req.query.profileId || req.body.profileId, 'profileId 必填')) return;
  const profileId = req.query.profileId || req.body.profileId;
  const v = await dao.setVocabularyMastered(req.params.id, profileId, req.body.mastered);
  if (!v) return res.status(404).json({ error: '单词不存在' });
  res.json(v);
}));

// 复习打卡：{known:true/false}，按记忆曲线 1/3/7/15/30 天推进或重置
router.post('/:id/review', ah(async (req, res) => {
  if (need(res, req.query.profileId || req.body.profileId, 'profileId 必填')) return;
  if (need(res, typeof req.body.known === 'boolean', 'known 必填且为布尔值')) return;
  const profileId = req.query.profileId || req.body.profileId;
  const v = await dao.reviewVocabulary(req.params.id, profileId, req.body.known);
  if (!v) return res.status(404).json({ error: '单词不存在' });
  res.json(v);
}));

module.exports = router;
