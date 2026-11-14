// 流式输出回归测试：纯函数 + 模拟流，不碰数据库、不调外部接口
// 跑法：npm test（node --test）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { askStream, _test } = require('../src/ai/providers.js');
const { extractOpenAIDelta, extractGeminiText, extractOllamaText, pumpSseStream } = _test;

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

describe('askStream 演示模式', () => {
  it('示例回答被切成多段推出，拼起来等于整段', async () => {
    const got = [];
    const r = await askStream({ model: 'demo', question: '解方程 2x+5=13', onToken: (t) => got.push(t) });
    assert.ok(got.length > 1, '应该推多段');
    assert.equal(got.join(''), r.answer);
    assert.match(r.answer, /演示模式/);
    assert.equal(r.webSearched, false);
  });
});
