// RAG 多轮跑题回归（M2 第二轮）：检索 query 必须带上文、提示词不能无条件优先教材。
// 覆盖：buildRetrievalQuery（kb.js）、buildFinalQuestion（ai.js）、system 提示词（providers.js）。
// 全部纯函数，不出网、不连数据库。
const { test, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRetrievalQuery, needsRetrievalContext } = require('../src/routes/kb');
const { _test: aiTest } = require('../src/routes/ai');
const { buildFinalQuestion } = aiTest;
const { _test: provTest } = require('../src/ai/providers');
const { openAICompatibleBody } = provTest;

// M2 实测四轮的真实问题与历史（模型 glm-4v-flash，测试账号）
const R1_Q = '集合的定义是什么';
const R1_A = '集合的定义如下：一般地，我们把研究对象统称为元素，把一些元素组成的总体叫做集合。';
const R2_Q = '那它的表示方法有哪些';
const R3_Q = '举一个具体的例子';

describe('buildRetrievalQuery：检索 query 带上文', () => {
  it('M2 第 2 轮：指代式追问带上第 1 轮的“集合”', () => {
    const hist = [
      { role: 'user', content: R1_Q },
      { role: 'assistant', content: R1_A },
    ];
    const q = buildRetrievalQuery(R2_Q, hist);
    assert.ok(q.includes('集合的定义是什么'), '检索 query 应包含上轮主题：' + q);
    assert.ok(q.includes(R2_Q), '检索 query 应保留本轮问题');
  });
  it('M2 第 3 轮：短句追问能找回第 1 轮的主题', () => {
    const hist = [
      { role: 'user', content: R1_Q },
      { role: 'assistant', content: R1_A },
      { role: 'user', content: R2_Q },
      { role: 'assistant', content: '函数的表示方法有解析法、列表法、图象法。' },
    ];
    const q = buildRetrievalQuery(R3_Q, hist);
    assert.ok(q.includes('集合的定义是什么'), '检索 query 应找回第 1 轮主题：' + q);
  });
  it('没有历史时原样返回本轮问题', () => {
    assert.equal(buildRetrievalQuery(R2_Q, []), R2_Q);
    assert.equal(buildRetrievalQuery(R1_Q, null), R1_Q);
  });
  it('本轮已有明确新主题时不带上文（避免旧主题污染）', () => {
    const hist = [
      { role: 'user', content: R1_Q },
      { role: 'assistant', content: R1_A },
    ];
    const q = '请详细讲讲函数的单调性怎么判断';
    assert.equal(buildRetrievalQuery(q, hist), q);
  });
  it('只用用户问题：历史里只有 assistant 回答时不带上文', () => {
    const hist = [{ role: 'assistant', content: '函数的表示方法有解析法。' }];
    assert.equal(buildRetrievalQuery(R2_Q, hist), R2_Q);
  });
  it('本轮问题已在历史里时不重复拼', () => {
    const hist = [{ role: 'user', content: R2_Q }];
    assert.equal(buildRetrievalQuery(R2_Q, hist), R2_Q);
  });
  it('needsRetrievalContext：指代词或短句才需要上文', () => {
    assert.equal(needsRetrievalContext(R2_Q), true);
    assert.equal(needsRetrievalContext(R3_Q), true);
    assert.equal(needsRetrievalContext('请详细讲讲函数的单调性怎么判断'), false);
    assert.equal(needsRetrievalContext(''), false);
  });
});

describe('buildFinalQuestion：教材采用改为有条件', () => {
  const ctx = '【教材来源1】《人教A版高中数学必修第一册》第一章， 第2页：\n集合的定义……';
  it('不再无条件“优先根据以上教材内容回答”', () => {
    const out = buildFinalQuestion(R2_Q, null, ctx);
    assert.ok(!out.includes('优先根据以上教材内容回答'), '不应再有无条件优先教材的指令');
    assert.ok(out.includes('只在与本轮问题和对话主题相关时才作为回答依据'), '应改为有条件采用');
    assert.ok(out.includes('忽略不相关的材料'), '应要求忽略不相关材料');
    assert.ok(out.includes('用户问题：' + R2_Q), '应保留原始用户问题');
  });
  it('命中 FAQ 时：只在确实回答本轮问题时才逐字照抄', () => {
    const faq = { question: '集合的表示方法有哪些？', answer: '列举法和描述法。', book: '人教A版高中数学必修第一册', page_start: 3 };
    const out = buildFinalQuestion(R2_Q, faq, ctx);
    assert.ok(out.includes('如果它确实回答了本轮问题，必须逐字照抄'), 'FAQ 应改为有条件逐字照抄');
    assert.ok(out.includes('一字不许改写'), '应要求逐字照抄、不许改写');
    assert.ok(!out.includes('答案已经人工校准过，请优先采用'), '不应再有无条件优先 FAQ 的旧写法');
  });
  it('未命中 FAQ 时不出现标准问答块', () => {
    const out = buildFinalQuestion(R2_Q, null, ctx);
    assert.ok(!out.includes('【标准问答】'), '无 FAQ 时不应有标准问答块');
  });
});

describe('system 提示词：主题一致性规则', () => {
  it('OpenAI 兼容路径的 system 含主题一致性规则', () => {
    const body = openAICompatibleBody({ modelName: 'glm-4v-flash', question: R2_Q, history: [{ role: 'user', content: R1_Q }] });
    const sys = body.messages[0];
    assert.equal(sys.role, 'system');
    assert.ok(sys.content.includes('先结合对话历史确定本轮问题说的是什么'), 'system 应要求先结合历史确定主体');
    assert.ok(sys.content.includes('教材内容与本轮问题或对话主题不相关时，忽略它'), 'system 应要求忽略不相关教材');
  });
});
