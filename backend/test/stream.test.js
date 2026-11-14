// 流式输出回归测试：纯函数 + 模拟流，不碰数据库、不调外部接口
// 跑法：npm test（node --test）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { ask, askStream, _test } = require('../src/ai/providers.js');
const { extractOpenAIDelta, extractGeminiText, extractOllamaText, pumpSseStream, resolveThinkingModel, openAICompatibleBody } = _test;

// 模拟上游响应体：按给定字节块逐个返回
function mockRes(chunks) {
  const enc = new TextEncoder();
  const queue = chunks.map((c) => enc.encode(c));
  return {
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= queue.length) return { done: true, value: undefined };
            return { done: false, value: queue[i++] };
          },
          releaseLock() {},
        };
      },
    },
  };
}

describe('流式提取器（providers.js）', () => {
  it('OpenAI delta：只取 choices[0].delta.content', () => {
    assert.equal(extractOpenAIDelta({ choices: [{ delta: { content: '你好' } }] }), '你好');
    assert.equal(extractOpenAIDelta({ choices: [{ delta: {} }] }), '');
    assert.equal(extractOpenAIDelta({}), '');
  });
  it('Gemini：拼 parts 里的 text', () => {
    assert.equal(extractGeminiText({ candidates: [{ content: { parts: [{ text: '你' }, { text: '好' }] } }] }), '你好');
    assert.equal(extractGeminiText({}), '');
  });
  it('Ollama：取 message.content，done 行不出词', () => {
    assert.equal(extractOllamaText({ message: { content: '你好' }, done: false }), '你好');
    assert.equal(extractOllamaText({ done: true }), '');
  });
});

describe('pumpSseStream（行解析）', () => {
  it('SSE 行按顺序出词，[DONE] 停止', async () => {
    const res = mockRes([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const got = [];
    await pumpSseStream(res, extractOpenAIDelta, (t) => got.push(t));
    assert.deepEqual(got, ['你', '好']);
  });
  it('一个 JSON 被拆到两个包也能拼全', async () => {
    const res = mockRes([
      'data: {"choices":[{"delta":{"con',
      'tent":"你好"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const got = [];
    await pumpSseStream(res, extractOpenAIDelta, (t) => got.push(t));
    assert.deepEqual(got, ['你好']);
  });
  it('Ollama 裸 JSON 行也能读，done 行不出词', async () => {
    const res = mockRes([
      '{"message":{"content":"你"},"done":false}\n{"message":{"content":"好"},"done":false}\n{"done":true}\n',
    ]);
    const got = [];
    await pumpSseStream(res, extractOllamaText, (t) => got.push(t));
    assert.deepEqual(got, ['你', '好']);
  });
  it('空行和心跳注释跳过', async () => {
    const res = mockRes([': ping\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\n']);
    const got = [];
    await pumpSseStream(res, extractOpenAIDelta, (t) => got.push(t));
    assert.deepEqual(got, ['好']);
  });
});

// 深度思考切推理模型（resolveThinkingModel）：纯函数，不调外部接口
// DeepSeek 不走这里：它现在没有独立的推理模型名，改在请求里加 thinking 参数
describe('深度思考切推理模型', () => {
  it('关时原样返回（没指定模型名就返回 undefined，走默认）', () => {
    assert.equal(resolveThinkingModel('deepseek', undefined, false), undefined);
  });
  it('DeepSeek 开：不切模型名（thinking 走请求参数）', () => {
    assert.equal(resolveThinkingModel('deepseek', undefined, true), undefined);
  });
  it('OpenAI 开：切 o3', () => {
    assert.equal(resolveThinkingModel('openai', undefined, true), 'o3');
  });
  it('Gemini 开：切 gemini-2.5-flash', () => {
    assert.equal(resolveThinkingModel('gemini', undefined, true), 'gemini-2.5-flash');
  });
  it('用户自己填了模型名：不切，尊重他的选择', () => {
    assert.equal(resolveThinkingModel('openai', 'gpt-4o-mini', true), 'gpt-4o-mini');
  });
});

// 思考开关进请求体（openAICompatibleBody）：DeepSeek/智谱用 thinking 参数
describe('thinking 参数进请求体', () => {
  it('传 thinking=enabled：请求体带 thinking.type=enabled', () => {
    const b = openAICompatibleBody({ modelName: 'deepseek-flash', question: 'hi', thinking: 'enabled' });
    assert.equal(b.model, 'deepseek-flash');
    assert.deepEqual(b.thinking, { type: 'enabled' });
  });
  it('传 thinking=disabled：请求体带 thinking.type=disabled', () => {
    const b = openAICompatibleBody({ modelName: 'deepseek-flash', question: 'hi', thinking: 'disabled' });
    assert.deepEqual(b.thinking, { type: 'disabled' });
  });
  it('不传 thinking：请求体没有 thinking 字段', () => {
    const b = openAICompatibleBody({ modelName: 'gpt-4o-mini', question: 'hi' });
    assert.equal('thinking' in b, false);
  });
});

// 演示模式已删：没 Key 就报错，不推假词、不给假答案
describe('没 Key 直接报错', () => {
  it('askStream 没 Key：不推一个词，直接抛错', async () => {
    const saved = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
      const got = [];
      await assert.rejects(
        askStream({ model: 'deepseek', question: '解方程 2x+5=13', onToken: (t) => got.push(t) }),
        /AI Key/
      );
      assert.deepEqual(got, []);
    } finally {
      if (saved !== undefined) process.env.AI_API_KEY = saved;
    }
  });
  it('ask 没 Key：直接抛错', async () => {
    const saved = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
      await assert.rejects(ask({ model: 'deepseek', question: '你好' }), /AI Key/);
    } finally {
      if (saved !== undefined) process.env.AI_API_KEY = saved;
    }
  });
});
