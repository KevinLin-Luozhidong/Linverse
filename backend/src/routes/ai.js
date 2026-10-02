// AI 相关接口：图片上传 / AI 问答 / OCR 识图 / 词典
// POST /api/upload  POST /api/ask  POST /api/ocr  GET /api/dictionary
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dao = require('../db/dao');
const { ask } = require('../ai/providers');
const { ah, need } = require('./helpers');

const router = express.Router();

// ---------- 图片上传 ----------
// 安全限制：只收图片（jpeg/png/gif/webp），单文件上限 5MB
// 云端（Railway）设了 DATA_DIR 时，和数据库一起写进 Volume，重新部署不丢
const uploadDir = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  // 文件名：时间戳 + 随机数 + 原扩展名，避免重名和路径注入
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    // 只允许图片类型
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持上传图片（jpeg/png/gif/webp）'));
    }
  },
});

router.post('/upload', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择要上传的图片（字段名 file）' });
  res.json({ url: `/uploads/${req.file.filename}` });
}));

// ---------- 小工具：把 imageUrl 转成各家 vision 接口能用的格式 ----------
// - 本地 /uploads/xxx.jpg → 读文件转成 base64 data URI（云端 AI 访问不到我们内网地址，必须转 base64）
// - http(s) 链接 / data: 开头 → 原样返回
function resolveImageForVision(imageUrl) {
  if (!imageUrl) return '';
  if (/^data:image\//.test(imageUrl) || /^https?:\/\//.test(imageUrl)) {
    return imageUrl;
  }
  if (imageUrl.startsWith('/uploads/')) {
    const filePath = path.join(uploadDir, path.basename(imageUrl)); // basename 防目录穿越
    if (!fs.existsSync(filePath)) return imageUrl;
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mime = ext === 'jpg' ? 'jpeg' : ext; // jpg → jpeg
    const base64 = fs.readFileSync(filePath).toString('base64');
    return `data:image/${mime};base64,${base64}`;
  }
  return imageUrl;
}

// ---------- AI 问答 ----------
// POST /api/ask  body: { profileId, conversationId?, question, imageUrl?, model, deepThink, aiKey? }
// 返回: { answer, thinkSeconds, conversationId, model }
router.post('/ask', ah(async (req, res) => {
  const { profileId, conversationId, question, imageUrl, model, deepThink, aiKey } = req.body;
  if (need(res, profileId, 'profileId 必填')) return;
  if (need(res, question && question.trim(), 'question 不能为空')) return;

  // 自定义供应商的地址和模型名从 settings 表里取（用户在设置页填的）
  let endpoint = '';
  let modelName = '';
  if (model === 'custom') {
    const s = dao.getSettings(profileId);
    endpoint = s.aiEndpoint;
    modelName = s.aiModel;
  }

  // 调统一入口 ask()：内部按 model 分发到不同供应商，无 Key 自动走演示模式
  const { answer, thinkSeconds } = await ask({
    model: model || 'demo',
    question: question.trim(),
    imageUrl: resolveImageForVision(imageUrl),
    deepThink: !!deepThink,
    aiKey,
    endpoint,
    modelName,
  });

  // 问答自动存档：有 conversationId 就续写，没有就新建（标题取问题前 12 个字）
  let cid = conversationId;
  if (cid) {
    // 防止串到别人的对话：必须同时匹配 profileId
    const conv = dao.getConversation(cid, profileId);
    if (!conv) return res.status(404).json({ error: '对话不存在' });
  } else {
    const title = question.trim().slice(0, 12) || '新的对话';
    cid = dao.createConversation(profileId, title).id;
  }
  dao.addMessage(profileId, cid, 'user', question.trim());
  dao.addMessage(profileId, cid, 'assistant', answer);

  res.json({ answer, thinkSeconds, conversationId: cid, model: model || 'demo' });
}));

// ---------- OCR：识别图片中的文字 ----------
// POST /api/ocr  body: { imageUrl, model?, aiKey? }
// 有 Key 时用 vision 模型识别；无 Key 诚实返回空文本 + 提示，不伪装结果
router.post('/ocr', ah(async (req, res) => {
  const { imageUrl } = req.body;
  if (need(res, imageUrl, 'imageUrl 必填')) return;

  const key = req.body.aiKey || process.env.AI_API_KEY || '';
  if (!key) {
    return res.json({ text: '', error: '需配置 AI Key' });
  }

  // OCR 走哪个供应商：请求体可指定，否则默认 deepseek（OpenAI 兼容，支持 vision）
  const model = req.body.model || 'deepseek';
  const started = Date.now();
  try {
    const { answer } = await ask({
      model,
      question: '请识别这张图片中的所有文字，原样输出，不要添加任何解释。',
      imageUrl: resolveImageForVision(imageUrl),
      deepThink: false,
      aiKey: key,
      endpoint: req.body.endpoint || '',
      modelName: req.body.modelName || '',
    });
    res.json({ text: answer.trim(), thinkSeconds: Number(((Date.now() - started) / 1000).toFixed(1)) });
  } catch (e) {
    res.json({ text: '', error: `OCR 失败：${e.message}` });
  }
}));

// ---------- 词典 ----------
// GET /api/dictionary?word=&profileId=
// 数据源：dictionaryapi.dev（免费、无需 Key）；中文释义用 MyMemory 免费翻译（失败就保留英文，不报错）
router.get('/dictionary', ah(async (req, res) => {
  const word = (req.query.word || '').trim().toLowerCase();
  if (need(res, word, 'word 必填')) return;

  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!r.ok) {
    return res.status(404).json({ error: '查不到这个单词' });
  }
  const data = await r.json();
  const entry = data[0] || {};

  // 把接口返回的结构整理成契约格式
  const meanings = [];
  const examples = [];
  const synonyms = new Set();
  for (const m of entry.meanings || []) {
    for (const d of m.definitions || []) {
      meanings.push({ pos: m.partOfSpeech || '', zh: '', en: d.definition || '' });
      if (d.example) examples.push(d.example);
      for (const s of [...(d.synonyms || []), ...(m.synonyms || [])]) synonyms.add(s);
    }
  }

  // 中文释义：用 MyMemory 免费翻译把英文释义翻成中文；翻译失败就保留英文，接口照常返回不报错
  try {
    await Promise.all(
      meanings.slice(0, 6).map(async (m) => {
        const tr = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(m.en)}&langpair=en|zh-CN`
        );
        const tj = await tr.json();
        const zh = tj?.responseData?.translatedText;
        // MyMemory 翻不出来时会原样返回英文或报错信息，做个简单过滤
        if (zh && zh !== m.en && !/INVALID|QUERY LENGTH/i.test(zh)) {
          m.zh = zh;
        }
      })
    );
  } catch {
    // 翻译服务挂了也不影响：英文释义照常返回
  }

  const result = {
    word: entry.word || word,
    phonetic: entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '',
    meanings,
    examples,
    synonyms: [...synonyms],
  };

  // 写入查词历史（同一账号同一词只保留一条）
  if (req.query.profileId) {
    dao.recordWordHistory(req.query.profileId, result.word);
  }

  res.json(result);
}));

module.exports = router;
