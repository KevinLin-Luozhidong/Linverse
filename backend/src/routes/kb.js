// RAG 知识库接口
// GET /api/kb/status —— 知识库块数（验证入库用）
// POST /api/kb/ingest —— 批量入库 body: { chunks: [...], clear?: true}
// POST /api/kb/search —— 向量检索 body: { question, topK?}，返回最相关的块
//
// 安全：这三个接口都挂在 /api 下，全局 x-site-token 鉴权自动生效
// （设了访问密码就必须带 token，没设密码就是公开状态）。
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

// 给 ai.js 用的内部检索：返回拼好的上下文 + 引用信息（书名/章节/页码）
async function searchKbContext(question, topK = 5) {
const vec = await embedQuery(question);
const rows = await dao.kbSearch(vec, topK);
if (!rows.length) return { context: '', refs: []};
const context = rows
.map((r, i) => {
const pg = r.page_start === r.page_end? `第${r.page_start}页`: `第${r.page_start}-${r.page_end}页`;
const where = [r.book, r.chapter, r.section].filter(Boolean).join('｜');
return `\n${r.text}`;
})
.join('\n\n');
const refs = rows.map((r) => ({
book: r.book,
chapter: r.chapter,
section: r.section,
page_start: r.page_start,
page_end: r.page_end,
}));
return { context, refs};
}

router.get('/status', ah(async (req, res) => {
res.json({ count: await dao.kbCount(), model: EMBED_MODEL, dim: EMBED_DIM});
}));

router.post('/ingest', ah(async (req, res) => {
const { chunks, clear} = req.body;
if (clear) await dao.kbClear();
if (need(res, Array.isArray(chunks) && chunks.length, 'chunks 不能为空')) return;
if (chunks.length > 100) {
return res.status(400).json({ error: '单次最多 100 块，请分批入库'});
}
for (const c of chunks) {
if (!c.text ||!Array.isArray(c.embedding) || c.embedding.length!== EMBED_DIM) {
return res.status(400).json({ error: '某块缺少 text，或 embedding 维度不是 2048'});
}
}
const n = await dao.kbInsertBatch(chunks);
res.json({ inserted: n, total: await dao.kbCount()});
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
