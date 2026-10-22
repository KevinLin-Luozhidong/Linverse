// RAG 知识库接口
// GET /api/kb/status —— 知识库块数（验证入库用）
// POST /api/kb/ingest —— 批量入库 body: { chunks: [...], clear?: true}
// POST /api/kb/search —— 向量检索 body: { question, topK?}，返回最相关的块
//
// 安全：所有接口都需要账号级凭证；如果设置了全站访问密码，还需要 x-site-token。
// 入库、FAQ 入库和删除整本书属于管理员操作，还必须带 30 分钟有效的 x-owner-token。
// 入库的向量必须和检索用同一个 embedding 模型（智谱 embedding-3，2048 维），
// 否则"问题向量"和"库里向量"不在同一个坐标系，相似度毫无意义。
const express = require('express');
const dao = require('../db/dao');
const { ah, need} = require('./helpers');

const router = express.Router();
const EMBED_MODEL = 'embedding-3';
const EMBED_DIM = 2048;

// 把问题转成向量：调智谱 embedding 接口。
// Key 走服务端环境变量 ZHIPU_API_KEY（Vercel 后台配置），不经过前端、不进数据库。
async function embedQuery(text) {
const key = process.env.ZHIPU_API_KEY;
if (!key) {
throw new Error('服务端未配置 ZHIPU_API_KEY（Vercel 环境变量），知识库检索不可用');
}
const res = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
body: JSON.stringify({ model: EMBED_MODEL, input: text}),
});
if (!res.ok) {
throw new Error(`embedding 请求失败：HTTP ${res.status}`);
}
const data = await res.json();
return data.data[0].embedding;
}

// RRF 融合：把向量榜和关键词榜的名次换算成分数相加（score = Σ 1/(60+rank)），
// 两边都靠前的块胜出。key 带"类型"，同一页的文字块和插图块可共存，天然去重。
function rrfFuse(vecRows, kwRows, k = 60) {
const keyOf = (r) => r.book + '|' + r.page_start + '-' + r.page_end + '|' +
((r.text || '').startsWith('【教材插图】') ? 'fig' : 'txt');
const map = new Map();
const add = (rows) => rows.forEach((r, i) => {
const key = keyOf(r);
const e = map.get(key) || { row: r, score: 0 };
e.score += 1 / (k + i + 1);
map.set(key, e);
});
add(vecRows); add(kwRows);
return [...map.values()].sort((a, b) => b.score - a.score).map((e) => e.row);
}

// 给 ai.js 用的内部检索：返回拼好的上下文 + 引用信息（书名/章节/页码）+ 标准问答命中
// 混合检索：向量（懂同义）+ 关键词（保精确术语）RRF 融合；
// 高频问答优先：问题向量与某道标准问答足够像（余弦距离 < 0.3）就直接采用标准答案；
// 任一失败都不炸，另一路照常工作，全失败才返回空（上层降级为普通问答）。
// 余弦距离阈值：低于此值视为高置信度命中，直接采用标准答案。
// 可通过环境变量 FAQ_THRESHOLD 调整（默认 0.3；值越小要求越严格）。
const FAQ_DISTANCE_THRESHOLD = parseFloat(process.env.FAQ_THRESHOLD) || 0.3;
async function searchKbContext(question, topK = 5) {
let vec = null;
let vecRows = [];
try {
vec = await embedQuery(question);
vecRows = await dao.kbSearch(vec, topK + 4);
} catch (e) {
console.warn('[rag] 向量检索失败，降级为纯关键词检索：', e.message);
}
let kwRows = [];
try {
kwRows = await dao.kbKeywordSearch(question, topK + 4);
} catch (e) {
console.warn('[rag] 关键词检索失败：', e.message);
}
// 标准问答匹配：复用问题向量，不额外花钱再调一次 embedding
let faq = null;
if (vec) {
try {
const frows = await dao.kbFaqSearch(vec);
if (frows.length && frows[0].distance < FAQ_DISTANCE_THRESHOLD) faq = frows[0];
} catch (e) {
console.warn('[rag] 问答库检索失败：', e.message);
}
}
// 命中标准问答时只留 2 块教材佐证（2026-10-22 优化）：标准答案已人工校准，
// 全量 5 块拼进去只是白烧 token、拖慢回答；没命中时保持 topK 不变
const uniq = rrfFuse(vecRows, kwRows).slice(0, faq ? 2 : topK);
if (!uniq.length && !faq) return { context: '', refs: [], faq: null };
const fmtPage = (r) => {
if (r.page_start <= 0) return '前言'; // 前言/导引块（PDF 前 7 页，无书页码）
return r.page_start === r.page_end? `第${r.page_start}页`: `第${r.page_start}-${r.page_end}页`;
};
// 每块正文前都带上真实出处标签，让 AI 引用时直接照抄真实书名和页码，不许自己编
const context = uniq
.map((r, i) => {
const where = [r.book, r.chapter, r.section].filter(Boolean).join('｜');
return `【教材来源${i + 1}】《${r.book}》${where}，${fmtPage(r)}：\n${r.text}`;
})
.join('\n\n');
const refs = uniq.map((r) => ({
book: r.book,
chapter: r.chapter,
section: r.section,
page_start: r.page_start,
page_end: r.page_end,
}));
return { context, refs, faq };
}

router.get('/status', ah(async (req, res) => {
res.json({ count: await dao.kbCount(), model: EMBED_MODEL, dim: EMBED_DIM});
}));

// 知识库管理页：按书统计（书名/总块数/图片块数/首次入库/最近入库）
router.get('/books', ah(async (req, res) => {
const books = await dao.kbBookStats();
res.json({ books: books.map((b) => ({
book: b.book,
chunks: b.chunks,
fig_chunks: b.fig_chunks,
text_chunks: b.text_chunks,
first_ingest: b.first_ingest,
last_ingest: b.last_ingest,
}))});
}));

// 知识库管理页：删除整本书。危险操作，前端必须二次确认。
// book 走 query（给前端 del helper 用），也兼容 body。
router.delete('/books', ah(async (req, res) => {
const book = (req.query.book || (req.body || {}).book || '').trim();
if (need(res, book, 'book 必填')) return;
const n = await dao.kbDeleteBook(book);
res.json({ deleted: n, book});
}));

router.post('/ingest', ah(async (req, res) => {
const { chunks, clear} = req.body || {};

// 先完整校验请求，再执行清空等有副作用的操作。
// 否则 clear=true 配合空 chunks 或无效 embedding 会导致知识库被清空后才返回 400。
if (need(res, Array.isArray(chunks) && chunks.length, 'chunks 不能为空')) return;
if (chunks.length > 100) {
return res.status(400).json({ error: '单次最多 100 块，请分批入库'});
}
for (const c of chunks) {
if (!c || typeof c.text !== 'string' || !c.text.trim() ||
!Array.isArray(c.embedding) || c.embedding.length !== EMBED_DIM ||
!c.embedding.every((v) => Number.isFinite(v))) {
return res.status(400).json({ error: '某块缺少有效 text，或 embedding 不是 2048 维有限数值数组'});
}
}
// clear=true 时，删除旧库和写入新块作为一个事务；插入失败会回滚，不会留下空库。
const n = clear === true
  ? await dao.kbReplaceBatch(chunks)
  : await dao.kbInsertBatch(chunks);
res.json({ inserted: n, total: await dao.kbCount()});
}));

// 高频问答入库：POST /api/kb/faq/ingest body: { items: [{book, chapter, question, answer, page_start, page_end, embedding}] }
// 问答是人工校准的，一次只加几条；去重靠人工，接口只做追加。
router.post('/faq/ingest', ah(async (req, res) => {
const { items } = req.body;
if (need(res, Array.isArray(items) && items.length, 'items 不能为空')) return;
if (items.length > 50) {
return res.status(400).json({ error: '单次最多 50 条，请分批入库'});
}
for (const c of items) {
if (!c.question || !c.answer ||!Array.isArray(c.embedding) || c.embedding.length!== EMBED_DIM) {
return res.status(400).json({ error: '某条缺少 question/answer，或 embedding 维度不是 2048'});
}
}
const n = await dao.kbFaqInsertBatch(items);
res.json({ inserted: n });
}));

router.post('/search', ah(async (req, res) => {
const { question, topK} = req.body;
if (need(res, question && question.trim(), 'question 不能为空')) return;
const vec = await embedQuery(question.trim());
const rows = await dao.kbSearch(vec, Math.min(topK || 5, 10));
res.json({
chunks: rows.map((r) => ({
book: r.book,
chapter: r.chapter,
section: r.section,
page_start: r.page_start,
page_end: r.page_end,
text: r.text,
distance: r.distance,
})),
});
}));

module.exports = router;
module.exports.searchKbContext = searchKbContext;
