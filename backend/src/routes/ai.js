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
//   在线查词（2026-10-25 定）：
//   1. 维基词典官方接口（Wikimedia，免费、无需 Key）——主查，释义最全；
//   2. 自有 ECDICT 词库（backend/data/ecdict.v2.json，与前端离线包同源）——补漏，中文释义现成、有音标；
//   中文释义：维基词典的英文释义用 MyMemory 免费翻译（失败就保留英文，不报错）；
//   ECDICT 自带中文释义，不再翻译。
// 弃用史：dictionaryapi.dev 对个别词（如 bot/bots）回 5xx（Cloudflare 1033），
//   且曾把服务故障误报成“查不到”，2026-10-25 弃用；Datamuse 同日由用户拍板去掉。
router.get('/dictionary', ah(async (req, res) => {
  const word = (req.query.word || '').trim().toLowerCase();
  if (need(res, word, 'word 必填')) return;
  // 把接口返回的结构整理成契约格式
  const meanings = [];
  const examples = [];
  const synonyms = new Set();
  let displayWord = word;
  let phonetic = '';
  let audioUrl = '';
  let wordForms = [];

  // ---------- 1. 维基词典主查 ----------
  // 释义带网页标记（链接、用法标签），只留纯文本；en 键下还混着 Translingual 等语言，必须按 language 过滤。
  // 注意：维基词典的 definition 接口不给音标和发音音频，这一路的 phonetic/audioUrl 留空。
  let wiktStatus = 0;
  try {
    const wr = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Linverse/0.3.3 (https://linverse.vercel.app)' },
    });
    wiktStatus = wr.status;
    if (wr.ok) {
      const wdata = await wr.json();
      for (const sec of wdata?.en || []) {
        if (sec.language !== 'English') continue;
        for (const d of sec.definitions || []) {
          const en = stripHtml(d.definition);
          if (!en) continue;
          meanings.push({ pos: sec.partOfSpeech || '', zh: '', en });
          for (const ex of d.examples || []) {
            const clean = stripHtml(typeof ex === 'string' ? ex : ex.example || '');
            if (clean) examples.push(clean);
          }
        }
      }
    }
  } catch {
    // 维基词典连不上/超时：往下走自有词库，不直接报错
  }

  // ---------- 2. 自有 ECDICT 词库补漏 ----------
  // 与前端离线包同源，服务端随函数打包一份（backend/data/ecdict.v2.json），
  // 在线查词不用等用户下载离线包也能用上自有词库；手机端下载仍只用于断网场景，绝不自动下载。
  // 映射沿用前端离线词典的口径：t 按行拆成多条中文释义，与 e 数组同下标对齐，x 解析词形变化。
  if (meanings.length === 0) {
    const hit = lookupEcdict(word);
    if (hit) {
      displayWord = hit.w;
      phonetic = hit.p || '';
      wordForms = parseWordForms(hit.x);
      const zhLines = (hit.t || '').split('\n').filter(Boolean).slice(0, 5);
      zhLines.forEach((zh, i) => {
        meanings.push({ pos: '', zh: zh.trim(), en: (hit.e[i] || '').trim() });
      });
      if (meanings.length === 0) {
        meanings.push({ pos: '', zh: '(暂无释义)', en: '' });
      }
    }
  }

  // ---------- 补音标和词形变化 ----------
  // 维基词典不给音标和词形变化，统一从自有 ECDICT 补（只补这两项，释义不动），
  // 这样维基优先的结果也有音标和“复数/过去式”那一栏；ECDICT 那路已经带了，这里就跳过。
  if (!phonetic || wordForms.length === 0) {
    const hit = lookupEcdict(word);
    if (hit) {
      if (!phonetic) phonetic = hit.p || '';
      if (wordForms.length === 0) wordForms = parseWordForms(hit.x);
    }
  }

  if (meanings.length === 0) {
    // 两边都没释义：维基明确 404 才是词不存在，其他情况都是服务出问题，说实话
    if (wiktStatus === 404) {
      return res.status(404).json({ error: '查不到这个单词' });
    }
    return res.status(502).json({ error: '在线词典服务暂时出问题，稍后再试，也可以切到离线词典' });
  }

  // 中文释义：只翻 zh 为空的（维基词典来的）；ECDICT 自带中文，不动。
  // MyMemory 免费翻译把英文释义翻成中文；翻译失败就保留英文，接口照常返回不报错
  try {
    await Promise.all(
      meanings.slice(0, 6).filter((m) => !m.zh && m.en).map(async (m) => {
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
    word: displayWord,
    phonetic,
    // audioUrl：维基词典和 ECDICT 都不给发音音频，留空（以前 dictionaryapi.dev 给过，已弃用）
    audioUrl,
    meanings,
    examples,
    synonyms: [...synonyms],
    ...(wordForms.length ? { wordForms: wordForms.slice(0, 8) } : {}),
  };

  // 写入查词历史（同一账号同一词只保留一条）
  if (req.query.profileId) {
    await dao.recordWordHistory(req.query.profileId, result.word);
  }

  res.json(result);
}));

// ---------- 维基释义清洗 + 自有 ECDICT 词库（服务端版） ----------
// stripHtml：维基释义带网页标记（链接、用法标签），只留纯文本。
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// parseWordForms：ECDICT x 字段是 exchange 词形变化串（d:过去分词/p:过去式/...），解析成前端展示用的标签。
function parseWordForms(x) {
  const labelMap = { p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数', r: '比较级', t: '最高级', s: '复数' };
  const out = [];
  for (const part of (x || '').split('/')) {
    const [k, v] = part.split(':');
    if (k && v && labelMap[k]) out.push({ form: v, label: labelMap[k] });
  }
  return out.slice(0, 8);
}

// lookupEcdict：数据文件 backend/data/ecdict.v2.json（与前端离线包同源；前端包更新时同步拷一份过来）。
// 懒加载：首次补漏时解析并建成 Map，之后常驻内存，不重复解析；文件缺失/损坏时只返回 null，不炸接口。
let _ecdictMap = null;
let _ecdictFailed = false;
function lookupEcdict(word) {
  if (_ecdictFailed) return null;
  if (!_ecdictMap) {
    try {
      const list = require('../../data/ecdict.v2.json');
      _ecdictMap = new Map();
      for (const e of list) {
        if (e && e.w) _ecdictMap.set(String(e.w).toLowerCase(), e);
      }
    } catch {
      _ecdictFailed = true;
      return null;
    }
  }
  return _ecdictMap.get(word) || null;
}

module.exports = router;
