// 联网搜索问句改写：时效问题加今天日期再搜，否则搜回 SEO 垃圾。
// 根因实测（2026-11-28）：智谱 search_std 直接搜"今日新闻"返回 2023 年旧文
// 和"某国领导人访问了另一个国家"这种模板 filler；改写成"2026年11月28日 今日
// 新闻"后立刻搜到当天新闻简报。search_pro 换引擎没用，改写才是根治。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/ai/providers');
const { isTimeSensitive, buildSearchQuery, buildSearchBlock } = _test;

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
});
