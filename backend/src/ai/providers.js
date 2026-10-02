// ============================================================================
// AI Provider 抽象层：所有跟大模型打交道的地方都走 ask() 这一个入口。
// 上层路由不用管是 DeepSeek、Gemini 还是本地 Ollama，参数格式永远一样。
//
// ask({ model, question, imageUrl, deepThink, aiKey, endpoint, modelName})
// model: 'demo' | 'deepseek' | 'gemini' | 'openai' | 'custom'
// aiKey: 优先用请求体里的 aiKey，其次用环境变量 AI_API_KEY，都没有就走演示模式
// endpoint: 只有 model=custom 时用（从 settings 表的 aiEndpoint 取）
// 返回：{ answer, thinkSeconds}
// ============================================================================

// 让程序睡 n 毫秒（演示模式模拟"思考中"用）
function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- 演示模式：没配 Key 时返回像样的示例回答（诚实标注，不伪装成真 AI） ----------

// 纯文字问题的示例回答：一道数学题的分步讲解
function demoTextAnswer(question) {
return `【演示模式】你还没有配置 AI Key，所以这是内置的示例回答。去「设置」页填上 Key 即可换成真实 AI。

针对你的问题「${question}」，真实 AI 会这样回答——以一道典型数学题为例：

**题目**：解方程 2x + 5 = 13

**解题步骤**：
1. **移项**：把常数项 5 移到等号右边，变号得 2x = 13 − 5
2. **合并**：右边计算得 2x = 8
3. **系数化为 1**：两边同时除以 2，得 x = 4
4. **检验**：把 x = 4 代入原方程，左边 = 2×4 + 5 = 13 = 右边 ✓

**易错点**：移项时别忘了变号；最后一定要把答案代回去验算一遍。

配置好 Key 后，把题目原样再问一遍，就能得到针对你这道题的真实讲解啦。`;
}

// 带图的示例回答：模拟"看图讲题"
function demoVisionAnswer(question) {
return `【演示模式】你还没有配置 AI Key，所以这是内置的示例回答。去「设置」页填上 Key 即可换成真实 AI 看图。

针对你的问题「${question || '（图片题目）'}」，真实 AI 看到图片后会这样讲题：

**读图**：我看到这是一道几何题，图中有一个三角形，已知两条边的长度和一个角的度数。

**思路**：
1. 先把图中所有已知条件标注出来，确认"已知什么、求什么"
2. 判断用哪个定理：有两边一夹角 → 想到余弦定理
3. 列式计算，注意单位和符号
4. 回头检查：答案是否符合常识（比如边长不能是负数）

配置好 Key 后再拍一次，就能得到针对这张图的真实讲解啦。`;
}

// ---------- 真实供应商 ----------

// 构造 OpenAI 兼容格式的请求体（DeepSeek / OpenAI / custom 的 /chat/completions 都用它）
// 有 imageUrl 时按各家的多模态（vision）格式把图塞进 messages
function openAICompatibleBody({ modelName, question, imageUrl}) {
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
{ role: 'system', content: '你是一位耐心的中国高中学习助手，用中文回答，分步骤讲解，语言通俗易懂。'},
{ role: 'user', content: userContent},
],
};
}

// DeepSeek：OpenAI 兼容接口
// 中文注释：DeepSeek 的 API 完全兼容 OpenAI 格式，直接调 /chat/completions
async function askDeepSeek({ question, imageUrl, aiKey, modelName}) {
const res = await fetch('https://api.deepseek.com/chat/completions', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}`},
body: JSON.stringify(
openAICompatibleBody({ modelName: modelName || 'deepseek-chat', question, imageUrl})
),
});
if (!res.ok) throw new Error(`DeepSeek 请求失败：${res.status}`);
const data = await res.json();
return data.choices?.[0]?.message?.content || '';
}

// OpenAI：官方接口
// 中文注释：和 DeepSeek 一样走 OpenAI 兼容的 /chat/completions，只是地址和模型名不同
async function askOpenAI({ question, imageUrl, aiKey, modelName}) {
const res = await fetch('https://api.openai.com/v1/chat/completions', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}`},
body: JSON.stringify(
openAICompatibleBody({ modelName: modelName || 'gpt-4o-mini', question, imageUrl})
),
});
if (!res.ok) throw new Error(`OpenAI 请求失败：${res.status}`);
const data = await res.json();
return data.choices?.[0]?.message?.content || '';
}

// Gemini：Google 的 generateContent 接口，格式和 OpenAI 不一样
// 中文注释：Gemini 不用 messages 数组，而是 contents/parts 结构；图用 inlineData 传 base64 或 fileData 传 URL
async function askGemini({ question, imageUrl, aiKey, modelName}) {
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
const res = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiKey}`,
{
method: 'POST',
headers: { 'Content-Type': 'application/json'},
body: JSON.stringify({
systemInstruction: { parts: [{ text: '你是一位耐心的中国高中学习助手，用中文回答，分步骤讲解。'}]},
contents: [{ parts}],
}),
}
);
if (!res.ok) throw new Error(`Gemini 请求失败：${res.status}`);
const data = await res.json();
return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

// 根据用户填的自定义地址，拼出真正的请求 URL，并判断是 OpenAI 格式还是 Ollama 格式
// 规则（按契约）：
// - 以 /v1 结尾 → 拼上 /chat/completions（OpenAI 兼容服务）
// - 只有根地址（如 http://localhost:11434）→ 走 Ollama 的 /api/chat
// - 已经是完整端点 → 原样使用
function resolveCustomEndpoint(endpoint) {
const e = String(endpoint || '').replace(/\/+$/, ''); // 去掉末尾多余的斜杠
if (!e) throw new Error('未配置自定义 AI 接口地址');
if (e.endsWith('/v1')) {
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

// Custom：用户自己填的接口（兼容 Ollama 本地模型）
// 中文注释：Ollama 的 /api/chat 和 OpenAI 的 /chat/completions 请求/响应格式不同，这里分别处理
async function askCustom({ question, imageUrl, aiKey, endpoint, modelName}) {
const { url, format} = resolveCustomEndpoint(endpoint);
const headers = { 'Content-Type': 'application/json'};
if (aiKey) headers.Authorization = `Bearer ${aiKey}`; // Ollama 本地一般不需要 Key，有就带上
let body;
let res;
if (format === 'ollama') {
// Ollama 格式：{ model, messages, stream:false}，返回 message.content
// Ollama 传图用 messages 里 content 数组的 image 字段（base64 或 URL）
let content = question;
if (imageUrl) content = `${question}\n（附带图片：${imageUrl}，请结合图片回答）`;
body = { model: modelName || 'llama3', messages: [{ role: 'user', content}], stream: false};
res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body)});
if (!res.ok) throw new Error(`自定义接口请求失败：${res.status}`);
const data = await res.json();
return data.message?.content || '';
}
// OpenAI 兼容格式
res = await fetch(url, {
method: 'POST',
headers,
body: JSON.stringify(openAICompatibleBody({ modelName: modelName || 'custom', question, imageUrl})),
});
if (!res.ok) throw new Error(`自定义接口请求失败：${res.status}`);
const data = await res.json();
return data.choices?.[0]?.message?.content || '';
}

// ---------- 统一入口 ----------

async function ask({ model, question, imageUrl, deepThink, aiKey, endpoint, modelName}) {
// Key 优先级：请求体 aiKey > 环境变量 AI_API_KEY > 无（演示模式）
const key = aiKey || process.env.AI_API_KEY || '';
const started = Date.now();

// 没 Key 或明确选 demo → 演示模式
if (!key || model === 'demo') {
if (deepThink) {
// 模拟"深度思考"：随机等 1~3 秒
await sleep(1000 + Math.random() * 2000);
}
const answer = imageUrl? demoVisionAnswer(question): demoTextAnswer(question);
return { answer, thinkSeconds: Number(((Date.now() - started) / 1000).toFixed(1))};
}

// 有 Key：按供应商分发
let answer;
switch (model) {
case 'deepseek':
answer = await askDeepSeek({ question, imageUrl, aiKey: key, modelName});
break;
case 'gemini':
answer = await askGemini({ question, imageUrl, aiKey: key, modelName});
break;
case 'openai':
answer = await askOpenAI({ question, imageUrl, aiKey: key, modelName});
break;
case 'custom':
answer = await askCustom({ question, imageUrl, aiKey: key, endpoint, modelName});
break;
default:
throw new Error(`不支持的模型类型：${model}`);
}
return { answer, thinkSeconds: Number(((Date.now() - started) / 1000).toFixed(1))};
}

module.exports = { ask};
