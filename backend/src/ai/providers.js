// ============================================================================
// AI Provider 抽象层：所有跟大模型打交道的地方都走 ask() 这一个入口。
// 上层路由不用管是 DeepSeek、Gemini 还是本地 Ollama，参数格式永远一样。
//
// ask({ model, question, imageUrl, deepThink, aiKey, endpoint, modelName})
// model: 'deepseek' | 'gemini' | 'openai' | 'custom'
// aiKey: 优先用请求体里的 aiKey，其次用环境变量 AI_API_KEY，都没有就报错（演示的假答案已删）
// endpoint: 只有 model=custom 时用（从 settings 表的 aiEndpoint 取）
// 返回：{ answer, thinkSeconds}
// ============================================================================

// 超时：AI 问答 60 秒、联网搜索 15 秒。注意：431171c 删演示时误删过这两行，
// 导致之后所有 ask 都报 FETCH_TIMEOUT_MS 未定义、线上问答全挂——以后删代码别动这块。
const FETCH_TIMEOUT_MS = 60000;
const MODELS_TIMEOUT_MS = 15000; // 模型列表单独短超时：见 listModels 注释
const SEARCH_TIMEOUT_MS = 15000;

// ---------- 真实供应商 ----------

// 多轮对话：历史只收 user/assistant 两类角色、内容只留字符串，最多 8 条
// （前端已截过，后端再卡一次，防坏数据进请求体）。路由传来的 historyMsgs
// 以前在 ask()/askStream() 入口就被丢掉了，多轮追问模型看不到上文（GPT 审查 M2）。
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));
}

// 构造 OpenAI 兼容格式的请求体（DeepSeek / OpenAI / custom 的 /chat/completions 都用它）
// 有 imageUrl 时按各家的多模态（vision）格式把图塞进 messages
// history：排在系统消息之后、本轮问题之前，模型才能接上文
function openAICompatibleBody({ modelName, question, imageUrl, thinking, history }) {
let userContent;
if (imageUrl) {
// OpenAI vision 格式：content 是数组，文字 + 图片混排
userContent = [
{ type: 'text', text: question},
{ type: 'image_url', image_url: { url: imageUrl}},
];
} else {
userContent = question;
}
return {
model: modelName,
messages: [
{ role: 'system', content: '你是一位耐心的中国高中学习助手，用中文回答，分步骤讲解，语言通俗易懂。数学公式不要用 LaTeX 符号（如 \(x\)、\[...\]），直接用普通文本书写，例如 ax + by = c，变量直接写 x、y。先结合对话历史确定本轮问题说的是什么（比如“它”指上文提到的东西），不要因为检索到的教材换了话题；教材内容与本轮问题或对话主题不相关时，忽略它；如果历史不足以确定所指，先问清楚再回答。'},
...sanitizeHistory(history),
{ role: 'user', content: userContent},
],
// thinking：DeepSeek/智谱的思考开关（enabled/disabled）；不传就不加这个字段
...(thinking ? { thinking: { type: thinking } } : {}),
};
}

// DeepSeek：OpenAI 兼容接口
// 中文注释：DeepSeek 的 API 完全兼容 OpenAI 格式，直接调 /chat/completions
// 把供应商返回的错误体解析成一句人话：优先取后端 error.message，没有就只报状态码
async function providerErrorText(res, name) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error?.message || body?.message || body?.error || ''
    if (typeof detail !== 'string') detail = ''
  } catch {}
  return detail ? `${name}请求失败：${res.status}（${detail}）` : `${name}请求失败：${res.status}`
}

async function askDeepSeek({ question, imageUrl, aiKey, modelName, deepThink, historyMsgs }) {
// DeepSeek 现在只有 deepseek-flash / deepseek-v4-pro 两个模型（deepseek-chat 已退役）；
// flash 能看图，是默认选择。深度思考是请求参数：开就 enabled，关就 disabled
//（不填时服务端默认开着，开关关了就必须显式关掉，否则开关等于没用）。
const res = await fetchWithSafeRedirects('https://api.deepseek.com/chat/completions', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}`},
body: JSON.stringify(
openAICompatibleBody({ modelName: modelName || 'deepseek-flash', question, imageUrl, thinking: deepThink ? 'enabled' : 'disabled', history: historyMsgs })
),
signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});
if (!res.ok) throw new Error(await providerErrorText(res, 'DeepSeek'));
const data = await res.json();
return data.choices?.[0]?.message?.content || '';
}

// OpenAI：官方接口
// 中文注释：和 DeepSeek 一样走 OpenAI 兼容的 /chat/completions，只是地址和模型名不同
async function askOpenAI({ question, imageUrl, aiKey, modelName, historyMsgs }) {
const res = await fetchWithSafeRedirects('https://api.openai.com/v1/chat/completions', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}`},
body: JSON.stringify(
openAICompatibleBody({ modelName: modelName || 'gpt-4o-mini', question, imageUrl, history: historyMsgs })
),
signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});
if (!res.ok) throw new Error(await providerErrorText(res, 'OpenAI'));
const data = await res.json();
return data.choices?.[0]?.message?.content || '';
}

// Gemini：Google 的 generateContent 接口，格式和 OpenAI 不一样
// 中文注释：Gemini 不用 messages 数组，而是 contents/parts 结构；图用 inlineData 传 base64 或 fileData 传 URL
// Gemini 的 contents 要求：第一条必须是 user 角色，且 user/model 必须交替出现。
// 历史按 user→user、assistant→model 映射；开头的非 user 条目丢掉；连续同角色合并，避免 API 报错。
function geminiContents(history, currentParts) {
  const items = sanitizeHistory(history).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  while (items.length && items[0].role !== 'user') items.shift();
  for (let i = items.length - 1; i > 0; i--) {
    if (items[i].role === items[i - 1].role) {
      items[i - 1].parts.push(...items[i].parts);
      items.splice(i, 1);
    }
  }
  if (items.length && items[items.length - 1].role === 'user') {
    items[items.length - 1].parts.push(...currentParts);
  } else {
    items.push({ role: 'user', parts: currentParts });
  }
  return items;
}

async function askGemini({ question, imageUrl, aiKey, modelName, historyMsgs }) {
const model = modelName || 'gemini-2.0-flash';
const parts = [{ text: question}];
if (imageUrl) {
// 如果是 http(s) 链接，用 fileData 直接引用；base64 则用 inlineData
if (/^https?:\/\//.test(imageUrl)) {
parts.push({ fileData: { mimeType: 'image/jpeg', fileUri: imageUrl}});
} else if (/^data:image\/(\w+);base64,/.test(imageUrl)) {
const m = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
parts.push({ inlineData: { mimeType: `image/${m[1]}`, data: m[2]}});
} else {
parts.push({ text: `（附带图片：${imageUrl}，请结合图片回答）`});
}
}
const res = await fetchWithSafeRedirects(
`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiKey}`,
{
method: 'POST',
headers: { 'Content-Type': 'application/json'},
body: JSON.stringify({
systemInstruction: { parts: [{ text: '你是一位耐心的中国高中学习助手，用中文回答，分步骤讲解。数学公式不要用 LaTeX 符号（如 \(x\)、\[...\]），直接用普通文本书写，例如 ax + by = c，变量直接写 x、y。先结合对话历史确定本轮问题说的是什么（比如“它”指上文提到的东西），不要因为检索到的教材换了话题；教材内容与本轮问题或对话主题不相关时，忽略它；如果历史不足以确定所指，先问清楚再回答。'}]},
contents: geminiContents(historyMsgs, parts),
}),
signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
}
);
if (!res.ok) throw new Error(await providerErrorText(res, 'Gemini'));
const data = await res.json();
return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

// SSRF 防护：自定义接口地址只允许 http/https，并拦掉内网/云元数据目标。
// 注意：localhost 与字面量回环（127.0.0.1、::1）同等放行——Ollama 本地模型的文档写明用途，
// 测试也明确祝福 127.0.0.1:11434；域名解析到内网仍照拦（防 DNS 重绑定），两者分开。
// 残留局限：发请求时若 DNS 被重绑定到内网（检查时解析是公网、请求时变内网），仍可能绕过；
// 302 跳转已修：问答 fetch 走 fetchWithSafeRedirects，每跳都重验目标，不再跟去内网（GPT 审查 M7）。
// 本应用威胁模型下（持号者本人填地址）可接受。
const net = require('net');
const dns = require('dns');
function isBlockedIp(ip) {
  if (!ip) return false;
  let v = String(ip).toLowerCase().split('%')[0]; // 去掉 IPv6 zone id
  // IPv4-mapped IPv6（如 ::ffff:192.168.1.1）按内嵌的 IPv4 判断
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) v = mapped[1];
  if (net.isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIP(v) === 6) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true; // fe80::/10
    if (v.startsWith('fc') || v.startsWith('fd')) return true; // ULA
    return false;
  }
  return false;
}
async function assertSafeEndpoint(endpoint) {
  let u;
  try { u = new URL(String(endpoint)); }
  catch { throw new Error('自定义接口地址写得不对，检查一下'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('自定义接口地址只支持 http/https');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return; // Ollama 本地：localhost 与字面量回环同等放行
  // 云元数据主机名
  if (host === 'metadata.google.internal' || host === 'metadata.google' || host === 'instance-data-compute-internal') {
    throw new Error('自定义接口地址不合法');
  }
  // 字面量 IP：直接判网段（WHATWG URL 解析已把 0x7f.0.0.1、2130706433 这类变形 IP 归一化成标准点分形式）
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('自定义接口地址不合法');
    return;
  }
  // 域名：解析后逐个判（防域名指向内网）；解析失败直接拒绝，不让请求带着未知目标发出去
  let addrs;
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error('自定义接口地址解析失败，检查一下地址');
  }
  if (addrs.some((a) => isBlockedIp(a.address))) {
    throw new Error('自定义接口地址不合法');
  }
}

// ---------- 安全重定向：问答 fetch 不跟随未校验的跳转 ----------
// 自定义地址只在初始 URL 做过 assertSafeEndpoint；302 能把请求带去内网地址（GPT 审查 M7，
// 代码里原来的注释也承认这个局限）。手动跟跳转：每跳都用 assertSafeEndpoint 重验目标，
// 合法跳转（http→https 升级、CDN）照走，内网目标直接拦。
// 301/302/303 时 POST 转 GET 并丢请求体；307/308 方法与请求体原样重发；跨源删 Authorization。
const MAX_REDIRECTS = 5;
async function fetchWithSafeRedirects(url, opts = {}) {
  let currentUrl = String(url);
  let method = (opts.method || 'GET').toUpperCase();
  let headers = { ...(opts.headers || {}) };
  let body = opts.body;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, { method, headers, body, signal: opts.signal, redirect: 'manual' });
    const status = res.status ?? 200; // 测试桩可能不带 status，按 200（非跳转）处理
    if (status < 300 || status >= 400) return res;
    if (hop === MAX_REDIRECTS) throw new Error(`请求重定向次数过多（超过 ${MAX_REDIRECTS} 次）`);
    const location = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
    if (!location) throw new Error('重定向缺少目标地址');
    let nextUrl;
    try { nextUrl = new URL(location, currentUrl); } catch { throw new Error('重定向目标地址不合法'); }
    // 每跳重验：协议、DNS、IP 网段（内网/云元数据直接拦）
    await assertSafeEndpoint(nextUrl.href);
    if (nextUrl.origin !== new URL(currentUrl).origin) {
      delete headers.Authorization;
      delete headers.authorization;
    }
    if ((status === 301 || status === 302 || status === 303) && method === 'POST') {
      method = 'GET';
      body = undefined;
      delete headers['Content-Type'];
      delete headers['content-type'];
    }
    currentUrl = nextUrl.href;
  }
  throw new Error(`请求重定向次数过多（超过 ${MAX_REDIRECTS} 次）`);
}

// 根据用户填的自定义地址，拼出真正的请求 URL，并判断是 OpenAI 格式还是 Ollama 格式
// 规则（按契约）：
// - 以 /v1 结尾 → 拼上 /chat/completions（OpenAI 兼容服务）
// - 只有根地址（如 http://localhost:11434）→ 走 Ollama 的 /api/chat
// - 已经是完整端点 → 原样使用
async function resolveCustomEndpoint(endpoint) {
await assertSafeEndpoint(endpoint);
const e = String(endpoint || '').replace(/\/+$/, ''); // 去掉末尾多余的斜杠
if (!e) throw new Error('未配置自定义 AI 接口地址');
// OpenAI 标准（/v1 结尾）和智谱（/v4 结尾）：自动拼上 /chat/completions
// 用户填 https://open.bigmodel.cn/api/paas/v4 就行，不用自己拼
if (e.endsWith('/v1') || e.endsWith('/v4')) {
return { url: e + '/chat/completions', format: 'openai'};
}
let pathname = '/';
try {
pathname = new URL(e).pathname;
} catch {
// 地址写得不规范就按完整端点原样用，让请求自己报错
}
if (pathname === '/' || pathname === '') {
return { url: e + '/api/chat', format: 'ollama'}; // Ollama 根地址
}
return { url: e, format: 'openai'}; // 完整端点原样用，按 OpenAI 格式发
}

// Ollama 看图要 base64：data: 链接直接拆出来；http(s) 链接先校验再下载转码
// （只认公网地址，内网目标直接拦，跟自定义接口地址同一套规则）；失败返回 null，调用方退回文字备注。
async function loadOllamaImage(imageUrl) {
  const dataMatch = String(imageUrl || '').match(/^data:image\/\w+;base64,(.+)$/);
  if (dataMatch) return dataMatch[1];
  if (!/^https?:\/\//.test(String(imageUrl || ''))) return null;
  try {
    await assertSafeEndpoint(imageUrl);
    const res = await fetchWithSafeRedirects(imageUrl, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 10 * 1024 * 1024) return null; // 空图或超过 10MB 不传
    return buf.toString('base64');
  } catch {
    return null;
  }
}

// Ollama 的消息列表：历史 + 本轮问题；有图时挂 images（base64），没图可传就退回文字备注
async function ollamaMessages({ question, imageUrl, historyMsgs }) {
  const message = { role: 'user', content: question };
  if (imageUrl) {
    const b64 = await loadOllamaImage(imageUrl);
    if (b64) message.images = [b64];
    else message.content = `${question}\n（附带图片：${imageUrl}，请结合图片回答）`;
  }
  return [...sanitizeHistory(historyMsgs), message];
}

// Custom：用户自己填的接口（兼容 Ollama 本地模型）
// 中文注释：Ollama 的 /api/chat 和 OpenAI 的 /chat/completions 请求/响应格式不同，这里分别处理
async function askCustom({ question, imageUrl, aiKey, endpoint, modelName, deepThink, historyMsgs }) {
const { url, format} = await resolveCustomEndpoint(endpoint);
const headers = { 'Content-Type': 'application/json'};
if (aiKey) headers.Authorization = `Bearer ${aiKey}`; // Ollama 本地一般不需要 Key，有就带上
let body;
let res;
if (format === 'ollama') {
// Ollama 格式：{ model, messages, stream:false}，返回 message.content
body = { model: modelName || 'llama3', messages: await ollamaMessages({ question, imageUrl, historyMsgs }), stream: false};
res = await fetchWithSafeRedirects(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
if (!res.ok) throw new Error(await providerErrorText(res, '自定义接口'));
const data = await res.json();
return data.message?.content || '';
}
// OpenAI 兼容格式
// 深度思考 + 智谱线路：加 thinking 开关（glm-4v-flash 实测接受，会多给分步推理过程）；
// 其他自定义接口不加——不是每家都认这个字段
const openAiBody = openAICompatibleBody({ modelName: modelName || 'custom', question, imageUrl, history: historyMsgs });
if (deepThink && String(endpoint || '').includes('bigmodel.cn')) openAiBody.thinking = { type: 'enabled' };
res = await fetchWithSafeRedirects(url, {
method: 'POST',
headers,
body: JSON.stringify(openAiBody),
signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});
if (!res.ok) throw new Error(await providerErrorText(res, '自定义接口'));
const data = await res.json();
return data.choices?.[0]?.message?.content || '';
}

// ---------- 智谱联网搜索 ----------
// 独立接口（不走 /chat/completions）：POST https://open.bigmodel.cn/api/paas/v4/web_search
// 只在"custom 供应商 + 地址是智谱 + 用户打开开关"时调用；失败不抛错，上层降级为普通问答
async function zhipuWebSearch(query, apiKey, recency) {
const res = await fetchWithSafeRedirects('https://open.bigmodel.cn/api/paas/v4/web_search', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
body: JSON.stringify({
search_engine: 'search_std', // 标准版：约 ¥0.01/次，以智谱控制台账单为准
search_query: query,
count: 5, // 只取 5 条：控制延迟和 prompt 长度
search_recency_filter: recency || 'noLimit',
}),
signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
});
if (!res.ok) throw new Error(await providerErrorText(res, '联网搜索'));
const data = await res.json();
const items = data.search_result || [];
return items.slice(0, 5).map((it) => ({
title: it.title || '',
content: String(it.content || '').slice(0, 500), // 单条截断，防 prompt 爆炸
link: it.link || '',
publish_date: normalizePublishDate(it.publish_date),
})).filter((it) => it.title || it.content);
}

// 搜索结果的发布日期归一化（GPT 评审 2026-11-28）：智谱 publish_date 是 string，
// 不承诺一定是 YYYY-MM-DD（可能带时间、可能为空）。只认白名单：开头是
// YYYY-MM-DD 的取前 10 位；其他非空原样保留（不猜、不换算时区）；空的返回 ''，
// 拼块时显示"未注明"。注意发布日期 ≠ 事件发生日，模型照抄即可。
function normalizePublishDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

// 把搜索结果拼成 prompt 前缀：要求模型注明来源，提醒时效性以来源为准
function buildSearchBlock(results) {
const lines = results.map((r, i) => {
let s = `${i + 1}. ${r.title}`;
s += `\n   发布日期：${r.publish_date || '未注明'}`;
if (r.content) s += `\n   ${r.content}`;
if (r.link) s += `\n   来源：${r.link}`;
return s;
});
return `【联网搜索结果（今天是 ${todayZh()}，仅供参考，时效性信息请以来源为准，回答时请注明信息来源；回答新闻类问题时，每条新闻开头必须标注该条的发布日期，照抄上面给出的日期，严禁编造，没有日期的写"日期未注明"；如果搜索结果与问题无关、过时或只是泛泛而谈，直接说明没搜到相关内容，不要编造通用建议）】\n`
+ lines.join('\n')
+ '\n\n【用户问题】\n';
}

// ---------- 联网搜索问句改写 ----------
// 实测教训（2026-11-28）："今日新闻"这种模糊问句直接搜，智谱 search_std
// 返回的全是 SEO 垃圾（2023 年旧文、"某国领导人访问了另一个国家"这种
// 模板 filler），模型拿不到真新闻，只能回"我没有实时更新能力"或编通用
// 建议。把今天日期写进问句（"2026年11月28日 今日新闻"）立刻能搜到当
// 天的新闻简报；search_pro 换引擎没用，改写问句才是根治。
// 时效词命中才改写（普通知识问题不加日期，别污染检索）。
const TIME_WORDS = /今天|今日|昨天|前天|明天|最新|最近|新闻|热点|现在|今年|本月|本周|昨晚|今早/;
function isTimeSensitive(q) { return TIME_WORDS.test(q || ''); }
function todayZh() {
  return new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });
}
function buildSearchQuery(question) {
  return isTimeSensitive(question) ? `${todayZh()} ${question}` : question;
}
async function searchForQuestion(question, searchKey) {
  const timeSensitive = isTimeSensitive(question);
  return zhipuWebSearch(buildSearchQuery(question), searchKey, timeSensitive ? 'day' : 'noLimit');
}

// ---------- 模型列表：拉取供应商的 /models，设置页做成点选 ----------
// 用户要"可选择"：模型名不能只靠手填。直接问供应商要列表（用他存的 Key），
// 列表里没有的（比如智谱的 glm-4v-flash 不在 /models 返回里）仍可手填。
// Gemini 的 Key 放 query 里（它不用 Bearer）；返回的 id 带 "models/" 前缀，要去掉。
async function listModels({ model, aiKey, endpoint }) {
  if (!aiKey) throw new Error('还没填 AI Key：去设置 → AI 接口填好 Key 再拉取模型列表');
  let url, kind;
  if (model === 'deepseek') {
    url = 'https://api.deepseek.com/v1/models'; kind = 'openai';
  } else if (model === 'openai') {
    url = 'https://api.openai.com/v1/models'; kind = 'openai';
  } else if (model === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(aiKey); kind = 'gemini';
  } else if (model === 'custom') {
    // 自定义：从接口地址推 models 地址（聊天地址去尾 + /models；本地 Ollama 走 /api/tags）
    const { url: chatUrl, format } = await resolveCustomEndpoint(endpoint);
    if (format === 'ollama') { url = chatUrl.replace(/\/api\/chat$/, '/api/tags'); kind = 'ollama'; }
    else { url = chatUrl.replace(/\/chat\/completions$/, '') + '/models'; kind = 'openai'; }
  } else {
    throw new Error(`不支持的模型类型：${model}`);
  }
  const headers = { 'Content-Type': 'application/json' };
  if (kind !== 'gemini') headers.Authorization = `Bearer ${aiKey}`;
  // 不跟随重定向：初始地址虽然过了 assertSafeEndpoint，但 302 能把请求转去
  // 169.254.169.254 这类内网地址（GPT 审查 M1）。宁可让合法跳转报错，也别让重定向绕过校验。
  // 超时 15 秒就直说，别等 60 秒：前端 20 秒会先断，后端再等下去只是空转；
  // 超时要报人话（"供应商 15 秒没回应"），别把 AbortError 原样抛给用户。
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(MODELS_TIMEOUT_MS), redirect: 'error' });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('拉取模型列表超时，供应商 15 秒没回应，重试一次试试');
    throw e;
  }
  if (!res.ok) throw new Error(await providerErrorText(res, '模型列表'));
  const data = await res.json();
  return normalizeModelIds(kind, data);
}

// 把各家 /models 的返回统一成 id 数组（纯函数，可离线测）
function normalizeModelIds(kind, data) {
  if (kind === 'ollama') {
    return [...new Set((data.models || []).map((m) => m.name).filter(Boolean))];
  }
  if (kind === 'gemini') {
    // Gemini 的 id 是 "models/gemini-2.0-flash" 这种，聊天时只用后半段
    return [...new Set((data.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean))];
  }
  return [...new Set((data.data || []).map((m) => m.id).filter(Boolean))];
}

// ---------- 统一入口 ----------

async function ask({ model, question, imageUrl, deepThink, aiKey, endpoint, modelName, webSearch, searchKey, historyMsgs }) {
// Key 优先级：请求体 aiKey > 环境变量 AI_API_KEY > 无（没 Key 就报错）
const key = aiKey || process.env.AI_API_KEY || '';
const started = Date.now();

// 没 Key 就直说：演示的假答案已删，没 Key 问不了，别给假回答糊弄人
if (!key) {
  throw new Error('还没填 AI Key：去设置 → AI 接口填好 Key 再提问');
}

let finalQuestion = question; // 搜索前缀只加进 finalQuestion，不改写入参 question
// 联网搜索（用户手动开关）：用"自定义"那栏的智谱 Key 去调智谱搜索，
// 跟当前聊的是哪个模型没关系——在 DeepSeek 上也能联网搜，不再只限智谱线路。
// searchKey 没传（自定义那栏不是智谱、或没填 Key）就不搜，直接普通问答
let webSearched = false;
if (webSearch && searchKey) {
try {
const results = await searchForQuestion(question, searchKey);
if (results.length) {
finalQuestion = buildSearchBlock(results) + question;
webSearched = true;
}
} catch (err) {
// 中文注释：搜索挂了不应该导致整题答不出来，打日志然后当没开过开关继续走
console.error('[web_search] 搜索失败，降级为普通问答：', err.message);
}
}

// 有 Key：按供应商分发（模型名是前端传来的有效名：用户选的，深度思考换推理模型也在前端算好）
let answer;
switch (model) {
case 'deepseek':
answer = await askDeepSeek({ question: finalQuestion, imageUrl, aiKey: key, modelName, deepThink: !!deepThink, historyMsgs });
break;
case 'gemini':
answer = await askGemini({ question: finalQuestion, imageUrl, aiKey: key, modelName, historyMsgs });
break;
case 'openai':
answer = await askOpenAI({ question: finalQuestion, imageUrl, aiKey: key, modelName, historyMsgs });
break;
case 'custom':
answer = await askCustom({ question: finalQuestion, imageUrl, aiKey: key, endpoint, modelName, deepThink: !!deepThink, historyMsgs });
break;
default:
throw new Error(`不支持的模型类型：${model}`);
}
return { answer, thinkSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), webSearched};
}

// ---------- 流式输出（SSE） ----------
// 人话：普通问答是等 AI 把整段写完、一次返回，前几秒界面一片黑、像卡住了。
// 流式是 AI 写一个词就推一个词，前端边收边显示，首字几百毫秒就出来。
// 协议：后端把上游的流原样透传成 SSE 事件（token 事件推词，done 事件收尾）。
// 各家流的格式不一样，但都是"一行一个 JSON"：
//   - OpenAI 兼容（DeepSeek/OpenAI/custom）：data: {"choices":[{"delta":{"content":"词"}}]}，结尾 data: [DONE]
//   - Gemini：data: {"candidates":[{"content":{"parts":[{"text":"词"}]}}]}
//   - Ollama：每行一个裸 JSON {"message":{"content":"词"},"done":false}，done:true 结束

// 从上游 JSON 里抠出本行新出的词（纯函数，可单测）
function extractOpenAIDelta(d) { return d?.choices?.[0]?.delta?.content || ''; }
function extractGeminiText(d) {
  const parts = d?.candidates?.[0]?.content?.parts || [];
  return parts.map((x) => x.text || '').join('');
}
function extractOllamaText(d) { return d?.message?.content || ''; }

// 把上游响应体一行行读出来，每行解析后把新词交给 onToken。
// 中途断行（一个 JSON 被拆到两个 TCP 包）用 buf 拼起来再解析，不丢词。
async function pumpSseStream(res, extract, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(':')) continue; // 空行 / 心跳注释
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (payload === '[DONE]') return;
        let d;
        try { d = JSON.parse(payload); } catch { continue; } // 半行 JSON 等下一包拼全
        const text = extract(d);
        if (text) onToken(text);
      }
    }
    // 尾巴上没换行符的最后一行（Ollama 偶尔这样）也别丢
    const tail = (buf + decoder.decode()).trim();
    if (tail && !tail.startsWith(':')) {
      const payload = tail.startsWith('data:') ? tail.slice(5).trim() : tail;
      if (payload && payload !== '[DONE]') {
        try { const text = extract(JSON.parse(payload)); if (text) onToken(text); } catch {}
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

// OpenAI 兼容接口的流式调用：body 里加 stream:true，上游就按行推词
async function streamOpenAICompatible({ url, body, headers, name, onToken }) {
  const res = await fetchWithSafeRedirects(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    // 流式回答整体可能超过 60 秒（长回答边写边推），按前端同款 120 秒兜底
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(await providerErrorText(res, name));
  await pumpSseStream(res, extractOpenAIDelta, onToken);
}

async function streamDeepSeek({ question, imageUrl, aiKey, modelName, deepThink, historyMsgs, onToken }) {
  await streamOpenAICompatible({
    url: 'https://api.deepseek.com/chat/completions',
    body: openAICompatibleBody({ modelName: modelName || 'deepseek-flash', question, imageUrl, thinking: deepThink ? 'enabled' : 'disabled', history: historyMsgs }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
    name: 'DeepSeek',
    onToken,
  });
}

async function streamOpenAI({ question, imageUrl, aiKey, modelName, historyMsgs, onToken }) {
  await streamOpenAICompatible({
    url: 'https://api.openai.com/v1/chat/completions',
    body: openAICompatibleBody({ modelName: modelName || 'gpt-4o-mini', question, imageUrl, history: historyMsgs }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
    name: 'OpenAI',
    onToken,
  });
}

async function streamGemini({ question, imageUrl, aiKey, modelName, historyMsgs, onToken }) {
  const model = modelName || 'gemini-2.0-flash';
  const parts = [{ text: question }];
  if (imageUrl) {
    if (/^https?:\/\//.test(imageUrl)) {
      parts.push({ fileData: { mimeType: 'image/jpeg', fileUri: imageUrl } });
    } else if (/^data:image\/(\w+);base64,/.test(imageUrl)) {
      const m = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      parts.push({ inlineData: { mimeType: `image/${m[1]}`, data: m[2] } });
    } else {
      parts.push({ text: `（附带图片：${imageUrl}，请结合图片回答）` });
    }
  }
  const res = await fetchWithSafeRedirects(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${aiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: '你是一位耐心的中国高中学习助手，用中文回答，分步骤讲解。数学公式不要用 LaTeX 符号（如 \(x\)、\[...\]），直接用普通文本书写，例如 ax + by = c，变量直接写 x、y。先结合对话历史确定本轮问题说的是什么（比如“它”指上文提到的东西），不要因为检索到的教材换了话题；教材内容与本轮问题或对话主题不相关时，忽略它；如果历史不足以确定所指，先问清楚再回答。' }] },
        contents: geminiContents(historyMsgs, parts),
      }),
      signal: AbortSignal.timeout(120000),
    }
  );
  if (!res.ok) throw new Error(await providerErrorText(res, 'Gemini'));
  await pumpSseStream(res, extractGeminiText, onToken);
}

async function streamCustom({ question, imageUrl, aiKey, endpoint, modelName, deepThink, historyMsgs, onToken }) {
  const { url, format } = await resolveCustomEndpoint(endpoint);
  const headers = { 'Content-Type': 'application/json' };
  if (aiKey) headers.Authorization = `Bearer ${aiKey}`;
  if (format === 'ollama') {
    // Ollama：stream:true 后按行推裸 JSON，不带 data: 前缀，done:true 结束
    const res = await fetchWithSafeRedirects(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: modelName || 'llama3', messages: await ollamaMessages({ question, imageUrl, historyMsgs }), stream: true }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(await providerErrorText(res, '自定义接口'));
    await pumpSseStream(res, extractOllamaText, onToken);
    return;
  }
  // 深度思考 + 智谱线路：加 thinking 开关（与 askCustom 同款）
  const openAiBody = openAICompatibleBody({ modelName: modelName || 'custom', question, imageUrl, history: historyMsgs });
  if (deepThink && String(endpoint || '').includes('bigmodel.cn')) openAiBody.thinking = { type: 'enabled' };
  await streamOpenAICompatible({
    url,
    body: openAiBody,
    headers,
    name: '自定义接口',
    onToken,
  });
}

// 流式统一入口：与 ask() 同款分发，只是把回答一个词一个词推给 onToken；
// 返回 { answer, thinkSeconds, webSearched }（answer 是全量文本，路由拿它存档）。
async function askStream({ model, question, imageUrl, deepThink, aiKey, endpoint, modelName, webSearch, searchKey, historyMsgs, onToken }) {
  const key = aiKey || process.env.AI_API_KEY || '';
  const started = Date.now();
  let answer = '';
  const emit = (t) => { answer += t; onToken(t); };

  // 没 Key 就直说，不推假词
  if (!key) {
    throw new Error('还没填 AI Key：去设置 → AI 接口填好 Key 再提问');
  }

  let finalQuestion = question;
  let webSearched = false;
  // 联网搜索：用"自定义"那栏的智谱 Key 搜，跟当前聊的模型没关系（见 ask 里的注释）
  if (webSearch && searchKey) {
    try {
      const results = await searchForQuestion(question, searchKey);
      if (results.length) {
        finalQuestion = buildSearchBlock(results) + question;
        webSearched = true;
      }
    } catch (err) {
      console.error('[web_search] 搜索失败，降级为普通问答：', err.message);
    }
  }

  // 模型名是前端传来的有效名，直接分发
  switch (model) {
    case 'deepseek':
      await streamDeepSeek({ question: finalQuestion, imageUrl, aiKey: key, modelName, deepThink: !!deepThink, historyMsgs, onToken: emit });
      break;
    case 'gemini':
      await streamGemini({ question: finalQuestion, imageUrl, aiKey: key, modelName, historyMsgs, onToken: emit });
      break;
    case 'openai':
      await streamOpenAI({ question: finalQuestion, imageUrl, aiKey: key, modelName, historyMsgs, onToken: emit });
      break;
    case 'custom':
      await streamCustom({ question: finalQuestion, imageUrl, aiKey: key, endpoint, modelName, deepThink: !!deepThink, historyMsgs, onToken: emit });
      break;
    default:
      throw new Error(`不支持的模型类型：${model}`);
  }
  return { answer, thinkSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), webSearched };
}

module.exports = { ask, askStream, listModels, isTimeSensitive };
// 导出纯函数供自动化测试
module.exports._test = { resolveCustomEndpoint, assertSafeEndpoint, isBlockedIp, extractOpenAIDelta, extractGeminiText, extractOllamaText, pumpSseStream, openAICompatibleBody, normalizeModelIds, sanitizeHistory, geminiContents, fetchWithSafeRedirects, loadOllamaImage, ollamaMessages, isTimeSensitive, buildSearchQuery, buildSearchBlock, normalizePublishDate, MODELS_TIMEOUT_MS };
