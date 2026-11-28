// /ask 路由回归测试：doKb 作用域 P0 回归（2026-11-28）
// 6f566f0 把 const doKb 声明在了 if (isStream) 块里，块外的 if (doKb) 读不到，
// 所有问答都报 doKb is not defined、线上聊天全挂。本测试用桩模块调真实 handler，
// 覆盖 doKb=true / false 两条分支，不碰数据库、不调外部接口。
// 跑法：npm test（node --test，每个测试文件独立进程，桩不会漏到别的测试）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// 先拿真实的 isTimeSensitive：doKb 的判断逻辑必须走真实现
const realProviders = require('../src/ai/providers.js');

// 桩掉 dao / providers / kb：路由 require 时拿到的是这些桩
function stubModule(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = {
    id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj,
  };
}
stubModule(require.resolve('../src/db/dao.js'), {
  getSettings: async () => ({}),
  getConversation: async () => ({ id: 1 }),
  createConversation: async () => ({ id: 99 }),
  addMessage: async () => ({}),
});
stubModule(require.resolve('../src/ai/providers.js'), {
  ask: async () => ({ answer: '桩回答', thinkSeconds: 0, webSearched: true }),
  askStream: async () => ({ answer: '桩回答', thinkSeconds: 0, webSearched: false }),
  listModels: async () => [],
  isTimeSensitive: realProviders.isTimeSensitive,
});
stubModule(require.resolve('../src/routes/kb.js'), {
  searchKbContext: async () => ({ context: '教材块', refs: [], faq: null }),
  buildRetrievalQuery: (q) => q,
});

const router = require('../src/routes/ai.js');

function findAskHandler() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/ask');
  assert.ok(layer, '找不到 /ask 路由');
  return layer.route.stack[0].handle; // ah() 包过的 handler
}

function mockRes() {
  const res = {
    statusCode: 200,
    jsonBody: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.jsonBody = b; return this; },
    writeHead() {}, write() {}, end() {},
  };
  return res;
}

describe('/ask 路由 doKb 作用域回归', () => {
  it('时效问题＋联网搜索（doKb=false）不抛错、正常返回答案', async () => {
    const handle = findAskHandler();
    const req = { body: { profileId: '3', question: '今日新闻', webSearch: true, searchKey: 'x', useKb: true, historyMsgs: [] } };
    const res = mockRes();
    let err = null;
    await handle(req, res, (e) => { err = e; });
    assert.equal(err, null, err && err.message);
    assert.ok(res.jsonBody && typeof res.jsonBody.answer === 'string');
    assert.equal(res.jsonBody.kbUsed, false);
  });

  it('普通问题＋查课本（doKb=true）不抛错、正常返回答案', async () => {
    const handle = findAskHandler();
    const req = { body: { profileId: '3', question: '集合的定义是什么', useKb: true, historyMsgs: [] } };
    const res = mockRes();
    let err = null;
    await handle(req, res, (e) => { err = e; });
    assert.equal(err, null, err && err.message);
    assert.ok(res.jsonBody && typeof res.jsonBody.answer === 'string');
    assert.equal(res.jsonBody.kbUsed, true);
  });

  it('有引用时 assistant 消息带 metadata.kbRefs 存档、user 消息不带', async () => {
    // 引用块持久化（迁移 011）：saveTurn 必须把本轮 kbRefs 写进 assistant 消息的
    // 第 5 参数 metadata 里，否则重进历史会话拿不到引用块。user 消息不带 metadata。
    const daoStub = require.cache[require.resolve('../src/db/dao.js')].exports;
    const kbStub = require.cache[require.resolve('../src/routes/kb.js')].exports;
    const calls = [];
    const origAdd = daoStub.addMessage;
    const origSearch = kbStub.searchKbContext;
    const refs = [{ book: '数学', chapter: '第一章', section: '1.1', page_start: 1, page_end: 2 }];
    daoStub.addMessage = async (...args) => { calls.push(args); return {}; };
    kbStub.searchKbContext = async () => ({ context: '教材块', refs, faq: null });
    try {
      const handle = findAskHandler();
      const req = { body: { profileId: '3', question: '集合的定义是什么', useKb: true, historyMsgs: [] } };
      const res = mockRes();
      let err = null;
      await handle(req, res, (e) => { err = e; });
      assert.equal(err, null, err && err.message);
      const assistantCall = calls.find((c) => c[2] === 'assistant');
      assert.ok(assistantCall, '没存 assistant 消息');
      assert.deepEqual(assistantCall[4], { kbRefs: refs });
      const userCall = calls.find((c) => c[2] === 'user');
      assert.ok(userCall, '没存 user 消息');
      assert.equal(userCall[4], undefined);
    } finally {
      daoStub.addMessage = origAdd;
      kbStub.searchKbContext = origSearch;
    }
  });
});
