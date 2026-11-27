// 模型列表（listModels）：拉取各供应商 /models 的解析逻辑。
// 网络层用桩 fetch 测（不真调供应商）；DeepSeek/智谱的真实接口形状已用连接器实测过：
// DeepSeek → {data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}；
// 智谱 → {data:[{id:'glm-4.5'},...]}，注意 glm-4v-flash 不在返回里，列表外手填仍保留。
const { test, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listModels, _test } = require('../src/ai/providers');
const { normalizeModelIds } = _test;

// 桩 fetch：按 URL 返回固定 JSON，不出网
function stubFetch(routes) {
  return async (url, opts) => {
    const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
    if (!hit) throw new Error('unexpected url: ' + url);
    const [, body] = hit;
    return { ok: true, json: async () => body };
  };
}

describe('normalizeModelIds（纯函数）', () => {
  it('OpenAI 格式：取 data[].id，去重', () => {
    assert.deepEqual(
      normalizeModelIds('openai', { data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }),
      ['a', 'b']
    );
  });
  it('Gemini 格式：去掉 models/ 前缀', () => {
    assert.deepEqual(
      normalizeModelIds('gemini', { models: [{ name: 'models/gemini-2.0-flash' }, { name: 'models/gemini-2.5-pro' }] }),
      ['gemini-2.0-flash', 'gemini-2.5-pro']
    );
  });
  it('Ollama 格式：取 models[].name', () => {
    assert.deepEqual(
      normalizeModelIds('ollama', { models: [{ name: 'llama3:latest' }, { name: 'qwen2.5:7b' }] }),
      ['llama3:latest', 'qwen2.5:7b']
    );
  });
  it('空数据返回空数组，不炸', () => {
    assert.deepEqual(normalizeModelIds('openai', {}), []);
    assert.deepEqual(normalizeModelIds('gemini', {}), []);
  });
});

describe('ask() 回归：超时常量必须存在', () => {
  // 431171c 删演示时误删了 FETCH_TIMEOUT_MS / SEARCH_TIMEOUT_MS 的定义，
  // 之后所有问答（包括联网搜索）在 fetch 前就报 ReferenceError、线上全挂，
  // 而当时的测试只测纯函数、没调过 ask()，所以没发现。这条就是防重犯的。
  test('ask() 能走完 DeepSeek 全流程（桩 fetch 返回 canned 答案）', async () => {
    const { ask } = require('../src/ai/providers');
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '你好' } }] }),
    });
    try {
      const r = await ask({ model: 'deepseek', question: '你好', aiKey: 'k', modelName: 'deepseek-flash', deepThink: false });
      assert.equal(r.answer, '你好');
      assert.equal(typeof r.thinkSeconds, 'number');
    } finally { delete global.fetch; }
  });

  test('联网搜索失败时降级为普通问答，不炸', async () => {
    const { ask } = require('../src/ai/providers');
    global.fetch = async (url) => {
      if (String(url).includes('web_search')) {
        return { ok: false, status: 402, json: async () => ({ error: { message: 'insufficient balance' } }) };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '普通答案' } }] }) };
    };
    try {
      const r = await ask({ model: 'custom', question: '今天天气', aiKey: 'k', endpoint: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'glm-4v-flash', deepThink: false, webSearch: true, searchKey: 'k' });
      assert.equal(r.answer, '普通答案');
      assert.equal(r.webSearched, false);
    } finally { delete global.fetch; }
  });
});

describe('listModels（桩 fetch）', () => {
  test('没 Key 就报错，不发请求', async () => {
    await assert.rejects(() => listModels({ model: 'deepseek', aiKey: '' }), /还没填 AI Key/);
  });

  test('DeepSeek：走 /v1/models，Bearer 鉴权', async () => {
    const seen = {};
    global.fetch = async (url, opts) => {
      seen.url = String(url);
      seen.auth = opts.headers.Authorization;
      return { ok: true, json: async () => ({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }) };
    };
    try {
      const models = await listModels({ model: 'deepseek', aiKey: 'k' });
      assert.deepEqual(models, ['deepseek-flash', 'deepseek-v4-pro']);
      assert.equal(seen.url, 'https://api.deepseek.com/v1/models');
      assert.equal(seen.auth, 'Bearer k');
    } finally { delete global.fetch; }
  });

  test('Gemini：Key 放 query，不走 Bearer', async () => {
    const seen = {};
    global.fetch = async (url, opts) => {
      seen.url = String(url);
      seen.auth = opts.headers.Authorization;
      return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.0-flash' }] }) };
    };
    try {
      const models = await listModels({ model: 'gemini', aiKey: 'k&x' });
      assert.deepEqual(models, ['gemini-2.0-flash']);
      assert.match(seen.url, /generativelanguage\.googleapis\.com\/v1beta\/models\?key=k%26x/);
      assert.equal(seen.auth, undefined);
    } finally { delete global.fetch; }
  });

  test('自定义（智谱地址）：聊天地址去尾 + /models', async () => {
    const seen = {};
    global.fetch = async (url, opts) => {
      seen.url = String(url);
      return { ok: true, json: async () => ({ data: [{ id: 'glm-4.5' }, { id: 'glm-4.6' }] }) };
    };
    try {
      // assertSafeEndpoint 内部要解析域名：用公开域名，VM 有网即可；失败则跳过这条
      const models = await listModels({ model: 'custom', aiKey: 'k', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
      assert.deepEqual(models, ['glm-4.5', 'glm-4.6']);
      assert.equal(seen.url, 'https://open.bigmodel.cn/api/paas/v4/models');
    } finally { delete global.fetch; }
  });

  test('供应商报错时透传状态码和原因', async () => {
    global.fetch = async () => ({
      ok: false, status: 401,
      json: async () => ({ error: { message: 'invalid key' } }),
    });
    try {
      await assert.rejects(() => listModels({ model: 'openai', aiKey: 'bad' }), /401.*invalid key/);
    } finally { delete global.fetch; }
  });
});

describe('listModels 不跟随重定向（GPT 审查 M1）', () => {
  // 初始地址过了 assertSafeEndpoint，不代表安全：302 能把请求转去内网地址。
  // 修法是 fetch 加 redirect: 'error'——真 fetch 遇到重定向直接抛错，不跟过去。
  // 桩 fetch 模拟这个行为：返回 302（带内网 Location），断言两点：
  // ① 请求里确实带了 redirect: 'error'；② 302 不会被当成模型列表解析，必须抛错。
  test('302 到内网地址：请求带 redirect:error，且抛错不解析', async () => {
    const { listModels } = require('../src/ai/providers');
    let capturedOpts = null;
    global.fetch = async (url, opts) => {
      capturedOpts = opts;
      return {
        ok: false, status: 302,
        headers: { get: (n) => (String(n).toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
        json: async () => ({ data: [{ id: 'mock-internal-response' }] }),
      };
    };
    try {
      await assert.rejects(
        listModels({ model: 'deepseek', aiKey: 'k' }),
        (e) => /302/.test(e.message)
      );
      assert.equal(capturedOpts.redirect, 'error');
    } finally { delete global.fetch; }
  });
});

describe('历史消息进请求体（GPT 审查 M2）', () => {
  const { sanitizeHistory, geminiContents, openAICompatibleBody } = _test;
  test('sanitizeHistory：只要 user/assistant、内容是字符串，最多 8 条', () => {
    const h = [
      { role: 'user', content: 'a' },
      { role: 'system', content: 'x' },
      { role: 'assistant', content: 123 },
      { role: 'assistant', content: 'b' },
    ];
    assert.deepEqual(sanitizeHistory(h), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    const long = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
    assert.equal(sanitizeHistory(long).length, 8);
    assert.deepEqual(sanitizeHistory(null), []);
  });
  test('geminiContents：开头非 user 丢掉，user/model 交替', () => {
    const c = geminiContents(
      [{ role: 'assistant', content: 'old' }, { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
      [{ text: 'q2' }]
    );
    assert.deepEqual(c.map((x) => x.role), ['user', 'model', 'user']);
    assert.equal(c[0].parts[0].text, 'q1');
  });
  test('ask() 把历史发给模型：messages 里系统消息、历史、本轮问题按顺序', async () => {
    const { ask } = require('../src/ai/providers');
    let capturedBody = null;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '海星' } }] }) };
    };
    try {
      await ask({
        model: 'deepseek', question: '我的暗号是什么？', aiKey: 'k', modelName: 'deepseek-flash', deepThink: false,
        historyMsgs: [
          { role: 'user', content: '我的暗号是海星。' },
          { role: 'assistant', content: '记住了，海星。' },
        ],
      });
      const msgs = capturedBody.messages;
      assert.equal(msgs[0].role, 'system');
      assert.equal(msgs[1].content, '我的暗号是海星。');
      assert.equal(msgs[2].content, '记住了，海星。');
      assert.equal(msgs[3].content, '我的暗号是什么？');
    } finally { delete global.fetch; }
  });
});

describe('Ollama 图片走 images 字段（GPT 审查 M3）', () => {
  const { ollamaMessages } = _test;
  test('data: 链接直接拆 base64 进 images', async () => {
    const msgs = await ollamaMessages({ question: '这图是什么', imageUrl: 'data:image/png;base64,aGVsbG8=', historyMsgs: [] });
    assert.deepEqual(msgs[0].images, ['aGVsbG8=']);
    assert.equal(msgs[0].content, '这图是什么');
  });
  test('http 链接下载转码进 images；下载失败退回文字备注', async () => {
    global.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('imgbytes') });
    try {
      const msgs = await ollamaMessages({ question: '这图是什么', imageUrl: 'https://8.8.8.8/pic.jpg', historyMsgs: [] });
      assert.equal(msgs[0].images[0], Buffer.from('imgbytes').toString('base64'));
    } finally { delete global.fetch; }
    global.fetch = async () => { throw new Error('boom'); };
    try {
      const msgs = await ollamaMessages({ question: '这图是什么', imageUrl: 'https://8.8.8.8/pic.jpg', historyMsgs: [] });
      assert.equal(msgs[0].images, undefined);
      assert.match(msgs[0].content, /附带图片/);
    } finally { delete global.fetch; }
  });
});

describe('安全重定向（GPT 审查 M7）', () => {
  const { fetchWithSafeRedirects } = _test;
  // 按脚本返回响应：每调一次 fetch 取下一条，记下每次的 url 和 opts
  function scriptedFetch(script) {
    const calls = [];
    let i = 0;
    const f = async (url, opts) => {
      calls.push({ url, opts });
      const step = script[Math.min(i++, script.length - 1)];
      return {
        ok: step.status >= 200 && step.status < 300,
        status: step.status,
        headers: { get: (n) => (String(n).toLowerCase() === 'location' ? (step.location || null) : null) },
        json: async () => step.json || {},
      };
    };
    return { fetch: f, calls };
  }
  test('302 到公网 IP：跟过去，POST 转 GET、丢请求体，同源保留 Authorization', async () => {
    const s = scriptedFetch([
      { status: 302, location: 'https://8.8.8.8/b' },
      { status: 200, json: { ok: true } },
    ]);
    global.fetch = s.fetch;
    try {
      const res = await fetchWithSafeRedirects('https://8.8.8.8/a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
        body: JSON.stringify({ a: 1 }),
      });
      assert.equal(res.status, 200);
      assert.equal(s.calls[1].url, 'https://8.8.8.8/b');
      assert.equal(s.calls[1].opts.method, 'GET');
      assert.equal(s.calls[1].opts.body, undefined);
      assert.equal(s.calls[1].opts.headers.Authorization, 'Bearer k');
    } finally { delete global.fetch; }
  });
  test('307 跨源：方法与请求体原样重发，但删 Authorization', async () => {
    const s = scriptedFetch([
      { status: 307, location: 'https://1.1.1.1/b' },
      { status: 200, json: { ok: true } },
    ]);
    global.fetch = s.fetch;
    try {
      await fetchWithSafeRedirects('https://8.8.8.8/a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
        body: JSON.stringify({ a: 1 }),
      });
      assert.equal(s.calls[1].opts.method, 'POST');
      assert.equal(s.calls[1].opts.body, JSON.stringify({ a: 1 }));
      assert.equal(s.calls[1].opts.headers.Authorization, undefined);
    } finally { delete global.fetch; }
  });
  test('302 到 169.254.169.254：直接拦，不发第二跳', async () => {
    const s = scriptedFetch([{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }]);
    global.fetch = s.fetch;
    try {
      await assert.rejects(fetchWithSafeRedirects('https://8.8.8.8/a', { method: 'GET' }), /不合法/);
      assert.equal(s.calls.length, 1);
    } finally { delete global.fetch; }
  });
  test('连续 6 次 302：超过 5 跳抛错', async () => {
    const s = scriptedFetch([{ status: 302, location: 'https://8.8.8.8/x' }]);
    global.fetch = s.fetch;
    try {
      await assert.rejects(fetchWithSafeRedirects('https://8.8.8.8/a', { method: 'GET' }), /重定向次数过多/);
      assert.equal(s.calls.length, 6);
    } finally { delete global.fetch; }
  });
});

describe('listModels 超时 15 秒就报人话（2026-11-28 用户报"卡住没反应"）', () => {
  test('超时常量 15 秒，且比前端 20 秒短', () => {
    assert.equal(_test.MODELS_TIMEOUT_MS, 15000);
    assert.ok(_test.MODELS_TIMEOUT_MS < 20000, '后端要先超时，前端 abort 不能抢掉人话错误');
  });
  test('供应商超时：AbortError 转成人话，不原样抛', async () => {
    const err = new DOMException('The operation timed out.', 'AbortError');
    const origFetch = global.fetch;
    global.fetch = async () => { throw err; };
    try {
      await assert.rejects(
        () => listModels({ model: 'deepseek', aiKey: 'k' }),
        /拉取模型列表超时，供应商 15 秒没回应/,
      );
    } finally {
      global.fetch = origFetch;
    }
  });
});
