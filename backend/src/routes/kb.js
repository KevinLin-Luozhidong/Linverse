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
// 以前这里没有超时：上游挂起会拖住整条 /ask（前端要 120 秒才放弃）；与问答主链路同档，60 秒放弃
signal: AbortSignal.timeout(60000),
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
// 检索 query 带上文（M2 跑题根因修法 P0）：追问里常有“它/那/这个”这种指代，
// 单看本轮问题不知道指什么，检索就会按字面去别的主題——第二轮“那它的表示方法
// 有哪些”就是这么检出函数那章的。只用用户问题、不用 assistant 回答（上一轮回
// 答本身可能已跑题）；最近两条用户问题都带上（第 3 轮“举一个具体的例子”也要能
// 找回第 1 轮的“集合”）。本轮问题本身已有明确主题时，不带上文，避免旧主题污
// 染新问题。纯函数，可离线测。
const ANAPHORIC_RE = /[它他她这那其此]|还|另外|再/;
function needsRetrievalContext(question) {
  const q = (question || '').trim();
  if (!q) return false;
  return ANAPHORIC_RE.test(q) || q.length <= 12;
}
function buildRetrievalQuery(question, historyMsgs) {
  const q = (question || '').trim();
  if (!q) return q;
  if (!needsRetrievalContext(q)) return q;
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];
  const users = hist
    .filter((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim() && m.content.trim() !== q)
    .map((m) => m.content.trim());
  if (!users.length) return q;
  return [...users.slice(-2), q].join(' ');
}
const FAQ_DISTANCE_THRESHOLD = parseFloat(process.env.FAQ_THRESHOLD) || 0.3;
// P1 相关性门槛（2026-11-28 标定）：向量检索的块按余弦距离过滤，距离超过此值视为不相关、不进 RRF。
// 标定数据（21 个问题 × top9，见 /tmp/kb_calib_results.json）：课内问题 top1 距离 0.32–0.52、
// 相关块最大 0.581；题外问题（天气/红烧肉/世界杯）top1 距离 0.71–0.75。阈值 0.6 取在两者
// 之间的空隙（0.58–0.71），既保住课内检索、又拦住明显跑题的块。注意：余弦距离不能
// 区分“题目在另一本没入库的书里”的情况（如点到直线距离公式在必修第二册），那类仍
// 会返回库内最接近的块，属已知局限。
const CHUNK_DISTANCE_THRESHOLD = parseFloat(process.env.KB_CHUNK_THRESHOLD) || 0.6;
// P1 相关性门槛（纯函数，可离线测）：向量块按余弦距离过滤，超过阈值的块不进 RRF。
function filterByDistance(rows, threshold = CHUNK_DISTANCE_THRESHOLD) {
  return (rows || []).filter((r) => typeof r.distance === 'number' && r.distance < threshold);
}
async function searchKbContext(question, topK = 5, profileId) {
// 向量链和关键词链互不依赖，并行跑（以前是串行等三段）；标准问答复用向量，拿到向量后再跑
const vecChain = (async () => {
try {
const vec = await embedQuery(question);
const vecRows = await dao.kbSearch(vec, topK + 4, profileId);
return { vec, vecRows };
} catch (e) {
console.warn('[rag] 向量检索失败，降级为纯关键词检索：', e.message);
return { vec: null, vecRows: [] };
}
})();
const kwChain = (async () => {
try {
return await dao.kbKeywordSearch(question, topK + 4, profileId);
} catch (e) {
console.warn('[rag] 关键词检索失败：', e.message);
return [];
}
})();
const [{ vec, vecRows: vecRowsRaw }, kwRows] = await Promise.all([vecChain, kwChain]);
// P1 相关性门槛：向量块按余弦距离过滤，超过阈值的块不进 RRF（关键词链不受影响，
// 它靠术语匹配、本身就不易返回完全无关的块）。题外问题过滤后 vecRows 为空，
// 整体很可能无上下文，上层降级为普通问答、不再硬引课本。
const vecRows = filterByDistance(vecRowsRaw);
// 标准问答匹配：复用问题向量，不额外花钱再调一次 embedding
let faq = null;
if (vec) {
try {
const frows = await dao.kbFaqSearch(vec, profileId);
if (frows.length && frows[0].distance < FAQ_DISTANCE_THRESHOLD) faq = frows[0];
} catch (e) {
console.warn('[rag] 问答库检索失败：', e.message);
}
}
// 命中标准问答时只留 2 块教材佐证（2026-10-22 优化）：标准答案已人工校准，
// 全量 5 块拼进去只是白烧 token、拖慢回答；没命中时保持 topK 不变
// 前言/导引块（page_start <= 0，无书页码）不进引用：那是写书的话（讲这本书怎么编），
// 不是知识点；混进来只会让回答去引一本"前言"、还占掉正经知识块的位置。
// 只有当所有命中块都是前言时才保留（免得整轮查课本落空）。
const fused = rrfFuse(vecRows, kwRows);
const nonPreface = fused.filter((r) => r.page_start > 0);
const uniq = (nonPreface.length ? nonPreface : fused).slice(0, faq ? 2 : topK);
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

// 知识库管理页：点书名展开，按书分页列块（章节/节/页码/正文摘要）。
// book 走路径参数（前端 encodeURIComponent），limit 1..100 默认 20，offset >= 0 默认 0。
router.get('/books/:book/chunks', ah(async (req, res) => {
const book = (req.params.book || '').trim();
if (need(res, book, 'book 必填')) return;
const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
const r = await dao.kbBookChunks(book, limit, offset);
res.json({ book, total: r.total, chunks: r.chunks });
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
const { question, topK, profileId} = req.body;
if (need(res, question && question.trim(), 'question 不能为空')) return;
const vec = await embedQuery(question.trim());
const rows = await dao.kbSearch(vec, Math.min(topK || 5, 10), profileId);
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
module.exports.buildRetrievalQuery = buildRetrievalQuery;
module.exports.needsRetrievalContext = needsRetrievalContext;
module.exports.filterByDistance = filterByDistance;
module.exports.CHUNK_DISTANCE_THRESHOLD = CHUNK_DISTANCE_THRESHOLD;
