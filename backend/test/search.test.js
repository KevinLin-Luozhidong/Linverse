// 联网搜索问句改写：时效问题加今天日期再搜，否则搜回 SEO 垃圾。
// 根因实测（2026-11-28）：智谱 search_std 直接搜"今日新闻"返回 2023 年旧文
// 和"某国领导人访问了另一个国家"这种模板 filler；改写成"2026年11月28日 今日
// 新闻"后立刻搜到当天新闻简报。search_pro 换引擎没用，改写才是根治。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/ai/providers');
const { isTimeSensitive, buildSearchQuery, buildSearchBlock, normalizePublishDate, NEWS_OUTPUT_RULES, searchForQuestion } = _test;

describe('isTimeSensitive（时效词判断）', () => {
  test('新闻类问句命中', () => {
    for (const q of ['今日新闻', '今天新闻', '最新消息', '最近有什么热点', '现在有什么新闻']) {
      assert.equal(isTimeSensitive(q), true, q);
    }
  });
  test('普通知识问题不命中', () => {
    for (const q of ['集合的定义是什么', '那它的表示方法有哪些', '函数是什么']) {
      assert.equal(isTimeSensitive(q), false, q);
    }
  });
});

describe('buildSearchQuery（问句改写）', () => {
  test('时效问题前面加今天日期', () => {
    const q = buildSearchQuery('今日新闻');
    assert.match(q, /^\d{4}年\d{1,2}月\d{1,2}日 今日新闻$/);
  });
  test('普通问题原样不动', () => {
    assert.equal(buildSearchQuery('集合的定义是什么'), '集合的定义是什么');
  });
});

describe('buildSearchBlock（搜索块提示词）', () => {
  test('带今天日期 + 搜不到就直说、别编通用建议', () => {
    const block = buildSearchBlock([{ title: '新闻早餐', content: '今日头条', link: 'https://example.com/a' }]);
    assert.match(block, /今天是 \d{4}年\d{1,2}月\d{1,2}日/);
    assert.match(block, /不要编造通用建议/);
    assert.match(block, /新闻早餐/);
    assert.match(block, /https:\/\/example\.com\/a/);
  });

  test('每条结果带发布日期行：有日期的显示、无日期的写未注明', () => {
    const block = buildSearchBlock([
      { title: 'A', content: 'c', link: 'https://example.com/a', publish_date: '2026-11-28' },
      { title: 'B', content: 'c', link: 'https://example.com/b', publish_date: '' },
    ]);
    assert.match(block, /发布日期：2026-11-28/);
    assert.match(block, /发布日期：未注明/);
    // 头部规则：说明"发布日期"字段就是来源网页的发布日期，不得混同事件日期
    assert.match(block, /来源网页的发布日期/);
    assert.match(block, /不得混用/);
  });
});

describe('NEWS_OUTPUT_RULES（时效问题的回答要求）', () => {
  test('固定模板＋上限 10 条＋不写开场结语＋日期未注明兜底', () => {
    assert.match(NEWS_OUTPUT_RULES, /最多10条不重复的新闻/);
    assert.match(NEWS_OUTPUT_RULES, /每个来源最多取2条/);
    assert.match(NEWS_OUTPUT_RULES, /同一事件只列一次/);
    assert.match(NEWS_OUTPUT_RULES, /不写开场或结语/);
    assert.match(NEWS_OUTPUT_RULES, /【来源发布：日期】/);
    assert.match(NEWS_OUTPUT_RULES, /写"日期未注明"/);
    assert.match(NEWS_OUTPUT_RULES, /不得把来源发布日期称为事件发生日期/);
    assert.match(NEWS_OUTPUT_RULES, /不输出只有标题的条目/);
  });
});

describe('searchForQuestion（搜 + 时效判断）', () => {
  // 桩掉全局 fetch：只测 searchForQuestion 的返回形状与日期归一化，不真调智谱
  function stubFetch() {
    const orig = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ search_result: [
        { title: 'A', content: 'c', link: 'https://example.com/a', publish_date: '2026-11-28T08:00:00+08:00' },
        { title: 'B', content: 'c', link: 'https://example.com/b' },
      ]}),
    });
    return () => { global.fetch = orig; };
  }
  test('时效问题返回 timeSensitive=true、结果带归一化日期', async () => {
    const restore = stubFetch();
    try {
      const { results, timeSensitive } = await searchForQuestion('今日新闻', 'k');
      assert.equal(timeSensitive, true);
      assert.equal(results.length, 2);
      assert.equal(results[0].publish_date, '2026-11-28');
      assert.equal(results[1].publish_date, '');
    } finally { restore(); }
  });
  test('普通问题返回 timeSensitive=false', async () => {
    const restore = stubFetch();
    try {
      const { timeSensitive } = await searchForQuestion('集合的定义是什么', 'k');
      assert.equal(timeSensitive, false);
    } finally { restore(); }
  });
});

describe('normalizePublishDate（发布日期归一化）', () => {
  test('YYYY-MM-DD 原样', () => {
    assert.equal(normalizePublishDate('2026-11-28'), '2026-11-28');
  });
  test('ISO 时间戳只取日期部分', () => {
    assert.equal(normalizePublishDate('2026-11-28T08:30:00+08:00'), '2026-11-28');
  });
  test('空值 / 缺失返回空串', () => {
    assert.equal(normalizePublishDate(''), '');
    assert.equal(normalizePublishDate(null), '');
    assert.equal(normalizePublishDate(undefined), '');
  });
  test('非日期字符串原样保留、不猜', () => {
    assert.equal(normalizePublishDate('昨天'), '昨天');
  });
});

describe('ask() 搜索只看原问题（RAG 拼串不得影响时效判断）', () => {
  // 线上实测回归（2026-11-28，测试账号 ID 3，会话 58）："集合的定义是什么"
  // 开了联网搜索后答出 5 条"黄道吉日"新闻。根因：ai.js 把拼了教材的 finalQuestion
  // 当 question 传进 ask()，ask() 拿它去判时效、拼搜索词；数学必修一第 2 页
  // 教材正文里有"今年"，整串被判成时效问题，搜索词变成"今天日期 + 教材全文"，
  // 搜回当天热点，还贴上 NEWS_OUTPUT_RULES，模型就只列新闻、不答问题了。
  // 修法：ai.js 另传 rawQuestion（用户原问题），ask()/askStream() 的搜索分类
  // 与搜索词只看 rawQuestion；拼了教材的 question 仍原样进模型提示词。
  const { ask } = require('../src/ai/providers');
  const AUGMENTED = '以下是教材中的相关内容（已按相关度排序，仅供参考）：\n\n【教材来源1】人民教育出版社 在小学和初中，我们已经接触过一些集合。今年我们进一步了解集合的含义。\n\n---\n用户问题：集合的定义是什么\n\n要求：教材内容只在与本轮问题和对话主题相关时才作为回答依据。';

  test('拼了教材的长串本身会被误判（对照：这就是当时的坑）', () => {
    assert.equal(isTimeSensitive(AUGMENTED), true);
  });

  test('rawQuestion 是普通问题：搜原问题、不贴新闻列表规则、教材仍进提示词', async () => {
    let searchQuery = null;
    let modelBody = '';
    const orig = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url);
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (u.includes('web_search')) {
        searchQuery = body.search_query;
        return { ok: true, status: 200, json: async () => ({ search_result: [
          { title: '2026年11月28日是不是黄道吉日', content: 'c', link: 'https://example.com/a', publish_date: '2026-11-28' },
        ]}) };
      }
      modelBody = JSON.stringify(body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '集合的定义是：把一些元素组成的总体。' } }] }) };
    };
    try {
      const r = await ask({ model: 'custom', question: AUGMENTED, rawQuestion: '集合的定义是什么', aiKey: 'k', endpoint: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'glm-4v-flash', webSearch: true, searchKey: 'k', historyMsgs: [] });
      assert.equal(searchQuery, '集合的定义是什么');
      assert.doesNotMatch(modelBody, /只依据上述联网搜索结果回答/);
      assert.match(modelBody, /今年/); // 教材内容仍在提示词里，没被修掉
      assert.match(r.answer, /集合的定义是/);
    } finally { global.fetch = orig; }
  });
});
