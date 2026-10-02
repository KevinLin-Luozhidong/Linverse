// Express 应用组装：中间件 + 静态托管 + 路由挂载 + 错误处理
const express = require('express');
const cors = require('cors');

const app = express();

// 允许跨域：前端 dev 服务器（5173）和手机局域网访问都需要
app.use(cors());
// 解析 JSON 请求体（问答、错题等接口都用 JSON）
app.use(express.json({ limit: '10mb' }));

// 注意：上传的图片现在直接存 Supabase Storage，返回的是 https 公开链接，
// 前端直接拿去显示，不再经过我们服务器，所以这里不需要静态托管 /uploads。
// （原来那行 express.static(…/uploads) 已删除：serverless 函数没有本地磁盘）

// 路由挂载（URL 和字段名按 API 契约，原样不动）
app.use('/api/profiles', require('./routes/profiles'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/mistakes', require('./routes/mistakes'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/vocabulary', require('./routes/vocabulary'));
app.use('/api/word-history', require('./routes/word_history'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api', require('./routes/stats')); // /api/checkin /api/stats /api/badges
app.use('/api', require('./routes/ai')); // /api/upload /api/ask /api/ocr /api/dictionary

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 404：未知 API 路径
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 统一错误处理：multer 的文件类型/大小错误、业务抛出的 Error 都转成 JSON
// 注意：错误信息只返回 message，不泄露堆栈
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.message && err.message.includes('只支持上传图片') ? 400 : 500;
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

module.exports = app;
