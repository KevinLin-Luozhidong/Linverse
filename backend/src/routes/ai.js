// AI 相关接口：图片上传 / AI 问答 / OCR 识图 / 词典
// POST /api/upload  POST /api/ask  POST /api/ocr  GET /api/dictionary
const express = require('express');
const multer = require('multer');
const path = require('path');
const dao = require('../db/dao');
const { ask } = require('../ai/providers');
const { ah, need } = require('./helpers');

const router = express.Router();

// ---------- Supabase Storage ----------
// 图片不再存本地磁盘（serverless 函数的磁盘是临时的，重启就丢），
// 改存 Supabase Storage。需要环境变量：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
// （service_role 的 Key 权限大，只能放服务端，绝不能给前端）
let _supabase = null;
function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!_supabase) {
    // 懒初始化单例：require 时不初始化，保证没配环境变量时 require 不炸
    const { createClient } = require('@supabase/supabase-js');
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

const BUCKET = 'linverse-uploads'; // 图片 bucket 名

// 确保 bucket 存在且公开可读；不存在就自动建一个，
// 建失败就报错提示用户去 Supabase 后台手动建（Storage → New bucket → Public）
async function ensureBucket(supabase) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error) {
    throw new Error(
      `图片存储空间不存在且自动创建失败，请去 Supabase 后台手动创建公开 bucket：${BUCKET}（${error.message}）`
    );
  }
}

// ---------- 图片上传 ----------
// 安全限制：只收图片（jpeg/png/gif/webp），单文件上限 5MB
// 用 memoryStorage：文件先放内存，再上传到 Supabase Storage（serverless 无本地磁盘）
const upload = multer({
  storage: multer.memoryStorage(),
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
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: '未配置 Supabase（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）' });
  }
  await ensureBucket(supabase);
  // 文件名：时间戳 + 随机数 + 原扩展名，避免重名和路径注入
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, req.file.buffer, { contentType: req.file.mimetype });
  if (error) throw new Error(`上传失败：${error.message}`);
  // 公开 URL，前端直接拿去显示，不用再过我们服务器
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  res.json({ url: data.publicUrl });
}));

// ---------- 小工具：把 imageUrl 转成各家 vision 接口能用的格式 ----------
// - Supabase 的 https 链接 / data: 开头 → 原样返回
// - 兼容老数据的 /uploads/xxx.jpg → 原样返回（新上传不再产生这种地址）
function resolveImageForVision(imageUrl) {
  if (!imageUrl) return '';
  return imageUrl;
}

// ---------- AI 问答 ----------
// POST /api/ask  body: { profileId, conversationId?, question, imageUrl?, model, deepThink, aiKey? }
// 返回: { answer, thinkSeconds, conversationId, model }
router.post('/ask', ah(async (req, res) => {
  const { profileId, conversationId, question, imageUrl, model, deepThink, aiKey, webSearch, useKb, historyMsgs } = req.body;
  if (need(res, profileId, 'profileId 必填')) return;
  if (need(res, question && question.trim(), 'question 不能为空')) return;

  // 自定义供应商的地址和模型名从 settings 表里取（用户在设置页填的）
  let endpoint = '';
  let modelName = '';
  if (model === 'custom') {
    const s = await dao.getSettings(profileId);
    endpoint = s.aiEndpoint;
    modelName = s.aiModel;
  }

  // RAG 查课本：开了开关就先做向量检索，把最相关的教材块拼进问题里。
  // 知识库是空的 / 没配 ZHIPU_API_KEY / 检索失败 → 静默降级为普通问答，不炸。
  let kbRefs = [];
  let kbUsed = false;
  let finalQuestion = question.trim();
  if (useKb) {
    try {
      const { searchKbContext } = require('./kb');
      const { context, refs, faq } = await searchKbContext(question.trim(), 5);
      if (faq || context) {
        kbUsed = true;
        kbRefs = refs;
        // 标准问答命中：人工校准过的答案放最前面，优先级最高
        const faqBlock = faq
          ? `【标准问答】下面这道问答与用户问题高度相关，答案已经人工校准过，请优先采用它的答案作答，数学符号和公式必须原文照抄、一字不许改写（√、≤、∈、∪ 等不许"翻译"成英文单词，不许改成 LaTeX）：\n问：${faq.question}\n答：${faq.answer}\n（参考：《${faq.book}》第${faq.page_start}页）\n\n---\n`
          : '';
        finalQuestion =
          faqBlock +
          `以下是教材中的相关内容（已按相关度排序，仅供参考），每段开头的【教材来源N】就是它的真实出处（书名和页码都是真的，直接照抄）：\n\n${context}\n\n---\n` +
          `用户问题：${question.trim()}\n\n` +
          `要求：优先根据以上教材内容回答；如果教材内容不足以回答，就用你自己的知识补足，但要说明哪些部分超出了教材范围；` +
          `引用教材时，必须照抄【教材来源N】里的真实书名和真实页码数字，格式为"（参考：《书名》第X页）"（X 换成真实页码数字）；` +
          `严禁用"第X页"三个字原文输出，严禁编造书名或页码。`;
      }
    } catch (e) {
      console.warn('[rag] 检索失败，降级为普通问答：', e.message);
    }
  }

  // 先调 AI，成功后再建会话存档（失败不留空会话）
  // webSearch：前端"联网搜索"开关；只在智谱线路生效，其他线路后端自动忽略
  const { answer, thinkSeconds, webSearched } = await ask({
    model: model || 'demo',
    question: finalQuestion,
    imageUrl: resolveImageForVision(imageUrl),
    deepThink: !!deepThink,
    aiKey,
    endpoint,
    modelName,
    webSearch: !!webSearch,
    // 多轮对话：最近 N 条历史消息（前端已截取最多 8 条）
    historyMsgs: Array.isArray(historyMsgs) ? historyMsgs : [],
  });

  // 问答自动存档：有 conversationId 就续写，没有就新建（标题取问题前 12 个字）
  let cid = conversationId;
  if (cid) {
    // 防止串到别人的对话：必须同时匹配 profileId
    const conv = await dao.getConversation(cid, profileId);
    if (!conv) return res.status(404).json({ error: '对话不存在' });
  } else {
    const title = question.trim().slice(0, 12) || '新的对话';
    cid = (await dao.createConversation(profileId, title)).id;
  }
  await dao.addMessage(profileId, cid, 'user', question.trim());
  await dao.addMessage(profileId, cid, 'assistant', answer);

  res.json({ answer, thinkSeconds, conversationId: cid, model: model || 'demo', webSearched: !!webSearched, kbUsed, kbRefs });
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
  // custom 模型：从账号设置里取 endpoint 和 modelName（前端不用每次都传）
  let endpoint = req.body.endpoint || '';
  let modelName = req.body.modelName || '';
  if (model === 'custom' && req.body.profileId) {
    const s = await dao.getSettings(req.body.profileId);
    endpoint = endpoint || s.aiEndpoint || '';
    modelName = modelName || s.aiModel || '';
  }
  const started = Date.now();
  try {
    const { answer } = await ask({
      model,
      question: '请识别这张图片中的所有文字，原样输出，不要添加任何解释。',
      imageUrl: resolveImageForVision(imageUrl),
      deepThink: false,
      aiKey: key,
      endpoint,
      modelName,
    });
    res.json({ text: answer.trim(), thinkSeconds: Number(((Date.now() - started) / 1000).toFixed(1)) });
  } catch (e) {
    res.json({ text: '', error: `OCR 失败：${e.message}` });
  }
}));

// ---------- 词典 ----------
// GET /api/dictionary?word=&profileId=&source=dict|ai&aiKey=&model=
// 数据源：
//   dict（默认）：dictionaryapi.dev（免费、无需 Key）；中文释义用 MyMemory 免费翻译（失败就保留英文，不报错）
router.get('/dictionary', ah(async (req, res) => {
  const word = (req.query.word || '').trim().toLowerCase();
  if (need(res, word, 'word 必填')) return;
  // 默认词典：dictionaryapi.dev 在国内经常连不上，加 6 秒超时，失败就快速报错（前端会试离线缓存）
  let r
  try {
    r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(6000),
    })
  } catch {
    return res.status(502).json({ error: '词典接口连不上，看看离线缓存' })
  }
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
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(m.en)}&langpair=en|zh-CN`,
          { signal: AbortSignal.timeout(5000) } // 国内连不上就快速跳过，别卡住整个查词
        );
        const tj = await tr.json();
        const zh = tj?.responseData?.translatedText;
        const matchScore = tj?.responseData?.match;
        // MyMemory 翻不出来时会原样返回英文或报错信息，做个过滤：
        // 1. 不能和原文相同；2. 不能是错误码；3. match=0 表示纯机器翻译质量极低，跳过；
        // 4. 必须含有至少一个中文字符，确保是有效的中文翻译
        if (
          zh && zh !== m.en &&
          !/INVALID|QUERY LENGTH/i.test(zh) &&
          matchScore !== 0 &&
          /[\u4e00-\u9fa5]/.test(zh)
        ) {
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
    // audioUrl：从 phonetics 数组中找第一个有 audio 的条目
    audioUrl: entry.phonetics?.find((p) => p.audio)?.audio || '',
    meanings,
    examples,
    synonyms: [...synonyms],
  };

  // 写入查词历史（同一账号同一词只保留一条）
  if (req.query.profileId) {
    await dao.recordWordHistory(req.query.profileId, result.word);
  }

  res.json(result);
}));

module.exports = router;
