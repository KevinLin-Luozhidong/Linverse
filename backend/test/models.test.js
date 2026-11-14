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
