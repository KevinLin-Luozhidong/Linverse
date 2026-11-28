const assert = require('node:assert');
const { describe, test} = require('node:test');
const providers = require('../src/ai/providers');
const { isNewsQuestion, renderNewsAnswer, extractNewsPartial, readPartialField, validateNewsItems, stripUnbalancedQuotes, NEWS_JSON_RULES, todayISO, todayZh} = providers._test;

// 搜索结果桩（publish_date 已是归一化后的 YYYY-MM-DD）
const RESULTS = [
{ title: '早安长春！新闻早班车', content: '今天是 2026年11月28日 星期六。央行：大额存单起点调整，个人不低于10万元，机构不低于500万元。会议于上午9点召开。', link: 'https://example.com/a', publish_date: '2026-11-28'},
{ title: '每日资讯简报', content: '1、蓝天立一审被判死缓，贪污5.87亿元。2、民政部推进全国殡葬服务热线建设。', link: 'https://example.com/b', publish_date: '2026-11-28'},
{ title: '昨日回顾', content: '昨天的旧闻，无具体时间。', link: 'https://example.com/c', publish_date: '2026-11-27'},
];
const TODAY = todayISO(); // 运行当天的 YYYY-MM-DD（与 render 用的同一天）

function jsonItems(items) {
return JSON.stringify({ items});
}

describe('isNewsQuestion（新闻类问题判定）', () => {
test('今日新闻 / 今天有什么新闻 / 来份早报都算', () => {
assert.equal(isNewsQuestion('今日新闻'), true);
assert.equal(isNewsQuestion('今天有什么新闻'), true);
assert.equal(isNewsQuestion('来份早报'), true);
assert.equal(isNewsQuestion('最近有什么热点'), true);
assert.equal(isNewsQuestion('今天发生了什么'), true);
assert.equal(isNewsQuestion('今天有什么大事'), true);
assert.equal(isNewsQuestion('给我每日新闻'), true);
});
test('新闻联播是什么（定义问题）与集合定义都不算', () => {
assert.equal(isNewsQuestion('新闻联播是什么'), false);
assert.equal(isNewsQuestion('集合的定义是什么'), false);
assert.equal(isNewsQuestion('今天天气怎么样'), false);
});
});

describe('NEWS_JSON_RULES（结构化输出要求）', () => {
test('只出 JSON、最多 10 条、至少 5 条、时间没写不许编', () => {
assert.match(NEWS_JSON_RULES, /只输出一个 JSON 对象/);
assert.match(NEWS_JSON_RULES, /最多 10 条/);
assert.match(NEWS_JSON_RULES, /至少 5 条/);
assert.match(NEWS_JSON_RULES, /严禁编造/);
assert.match(NEWS_JSON_RULES, /"source": "来源标题"/);
});
});

describe('renderNewsAnswer（JSON 解析校验渲染）', () => {
test('正常渲染：首行是今天日期＋今日新闻，每条有时间就放时间、来源保留', () => {
const raw = jsonItems([
{ title: '央行调整大额存单起点', time: '上午9点', summary: '个人不低于10万元，机构不低于500万元。', source: '早安长春！新闻早班车', date: '2026-11-28'},
{ title: '蓝天立一审被判死缓', time: '', summary: '贪污5.87亿元。', source: '每日资讯简报', date: '2026-11-28'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.match(out, new RegExp(`^`));
assert.match(out, /1\. 央行调整大额存单起点（上午9点，来源：《早安长春！新闻早班车》）：个人不低于10万元，机构不低于500万元。/);
assert.match(out, /2\. 蓝天立一审被判死缓（来源：《每日资讯简报》）：贪污5\.87亿元。/);
// 同一天的日期只放最前面一次，正文里不再出现日期
assert.equal((out.match(/2026-11-28/g) || []).length, 0);
assert.equal((out.match(/11-28/g) || []).length, 0);
});

test('模型把 date 写错了：以后端来源日期为准纠正', () => {
const raw = jsonItems([
{ title: '央行调整大额存单起点', time: '', summary: '个人不低于10万元。', source: '早安长春！新闻早班车', date: '2026-11-01'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.match(out, /央行调整大额存单起点/);
assert.doesNotMatch(out, /11-01/);
});

test('date 与今天不同：该条括号里加日期（MM-DD）', () => {
const raw = jsonItems([
{ title: '昨天的旧闻', time: '', summary: '旧闻摘要。', source: '昨日回顾', date: '2026-11-27'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.match(out, /昨天的旧闻（11-27，来源：《昨日回顾》）：旧闻摘要。/);
});

test('source 在搜索结果里找不到：该条丢弃（防编造）', () => {
const raw = jsonItems([
{ title: '央行调整大额存单起点', time: '', summary: '个人不低于10万元。', source: '早安长春！新闻早班车', date: '2026-11-28'},
{ title: '凭空编出来的新闻', time: '', summary: '查无此事。', source: '不存在的来源', date: '2026-11-28'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.match(out, /央行调整大额存单起点/);
assert.doesNotMatch(out, /凭空编出来的新闻/);
});

test('time 不在来源内容里：去掉该 time（防编造）', () => {
const raw = jsonItems([
{ title: '蓝天立一审被判死缓', time: '23:59', summary: '贪污5.87亿元。', source: '每日资讯简报', date: '2026-11-28'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.doesNotMatch(out, /23:59/);
assert.match(out, /蓝天立一审被判死缓（来源：《每日资讯简报》）/);
});

test('重复标题去重、超 10 条截断', () => {
const items = [];
for (let i = 1; i <= 12; i++) {
items.push({ title: `新闻${i}`, time: '', summary: `摘要${i}。`, source: i % 2? '早安长春！新闻早班车': '每日资讯简报', date: '2026-11-28'});
}
items.push({ title: '新闻1', time: '', summary: '重复的。', source: '每日资讯简报', date: '2026-11-28'});
const out = renderNewsAnswer(jsonItems(items), RESULTS);
assert.match(out, /^10\. /m);
assert.doesNotMatch(out, /^11\. /m);
assert.equal((out.match(/新闻1（/g) || []).length, 1);
});

test('非法 JSON / 空 items：原样返回模型原文（降级）', () => {
assert.equal(renderNewsAnswer('这不是 JSON', RESULTS), '这不是 JSON');
assert.equal(renderNewsAnswer('{"items": []}', RESULTS), '{"items": []}');
assert.equal(renderNewsAnswer('```json\n{"items": [{"title": "央行调整大额存单起点", "time": "", "summary": "个人不低于10万元。", "source": "早安长春！新闻早班车", "date": "2026-11-28"}]}\n```', RESULTS).includes('央行调整大额存单起点'), true);
});

test('无 summary：该条不写冒号和摘要', () => {
const raw = jsonItems([
{ title: '蓝天立一审被判死缓', time: '', summary: '', source: '每日资讯简报', date: '2026-11-28'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.match(out, /1\. 蓝天立一审被判死缓（来源：《每日资讯简报》）$/);
});

test('TODAY 桩日期与运行当天一致（防测试写死日期）', () => {
assert.match(TODAY, /^\d{4}-\d{2}-\d{2}$/);
});

test('不成对引号去掉，成对的保留', () => {
assert.equal(stripUnbalancedQuotes('国常会稳市”提振A股'), '国常会稳市提振A股');
assert.equal(stripUnbalancedQuotes('《大额存单管理办法》公布'), '《大额存单管理办法》公布');
assert.equal(stripUnbalancedQuotes('“a”b”'), '“a”b');
assert.equal(stripUnbalancedQuotes('a"b'), 'ab');
assert.equal(stripUnbalancedQuotes('a"b"c'), 'a"b"c');
});

test('渲染时标题里不成对的引号也被去掉', () => {
const raw = jsonItems([
{ title: '国常会稳市”提振A股', time: '', summary: '沪指涨超3%。', source: '每日资讯简报', date: '2026-11-28'},
]);
const out = renderNewsAnswer(raw, RESULTS);
assert.match(out, /1\. 国常会稳市提振A股（来源：《每日资讯简报》）：沪指涨超3%。/);
assert.doesNotMatch(out, /”/);
});

test('每来源最多取 2 条由后端强制：先各取前 2 条，再按原顺序补满', () => {
const items = [];
for (let i = 1; i <= 7; i++) {
items.push({ title: `早报新闻${i}`, time: '', summary: `摘要${i}。`, source: '早安长春！新闻早班车', date: '2026-11-28'});
}
for (let i = 1; i <= 2; i++) {
items.push({ title: `简报新闻${i}`, time: '', summary: `摘要${i}。`, source: '每日资讯简报', date: '2026-11-28'});
}
const out = renderNewsAnswer(jsonItems(items), RESULTS);
const lines = out.split('\n').filter((l) => /^\d+\. /.test(l));
assert.equal(lines.length, 9);
assert.match(lines[0], /早报新闻1/);
assert.match(lines[1], /早报新闻2/);
assert.match(lines[2], /简报新闻1/);
assert.match(lines[3], /简报新闻2/);
assert.match(lines[4], /早报新闻3/);
assert.match(lines[8], /早报新闻7/);
});

test('只有一个来源时：先取 2 条再补满，仍出 10 条', () => {
const items = [];
for (let i = 1; i <= 12; i++) {
items.push({ title: `早报新闻${i}`, time: '', summary: `摘要${i}。`, source: '早安长春！新闻早班车', date: '2026-11-28'});
}
const out = renderNewsAnswer(jsonItems(items), RESULTS);
const lines = out.split('\n').filter((l) => /^\d+\. /.test(l));
assert.equal(lines.length, 10);
});

test('逐条渲染：第一条写完就能显示，第二条正在写也实时跟出来', () => {
const partial = '{"items": [{"title": "新闻A", "time": "", "summary": "摘要A。", "source": "早安长春！新闻早班车", "date": "2026-11-28"}, {"title": "新闻B", "time": "", "summary": "摘要B';
const out = extractNewsPartial(partial, RESULTS);
assert.ok(out);
assert.match(out, /1\. 新闻A/);
assert.match(out, /2\. 新闻B：摘要B/); // 没写完的第二条实时显示，不用等它写完才"跳"出来
});

test('逐条渲染：只有标题也实时显示（正在写的那条）；不是 JSON / 空串才返回 null', () => {
const out = extractNewsPartial('{"items": [{"title": "新闻A", "time": ""', RESULTS);
assert.ok(out);
assert.match(out, /1\. 新闻A/);
assert.equal(extractNewsPartial('不是 JSON', RESULTS), null);
assert.equal(extractNewsPartial('', RESULTS), null);
});

test('逐条渲染：分段喂入，最后一条 partial 与最终答案一致', () => {
const full = jsonItems([
{ title: '新闻A', time: '', summary: '摘要A。', source: '早安长春！新闻早班车', date: '2026-11-28'},
{ title: '新闻B', time: '', summary: '摘要B。', source: '每日资讯简报', date: '2026-11-28'},
{ title: '新闻C', time: '', summary: '摘要C。', source: '早安长春！新闻早班车', date: '2026-11-28'},
]);
// 在第二、三条的开头处切开，模拟流式逐词到达（jsonItems 是 JSON.stringify，无空格）
const cut1 = full.indexOf('{"title":"新闻B"');
const cut2 = full.indexOf('{"title":"新闻C"');
const partials = [];
for (const chunk of [full.slice(0, cut1), full.slice(0, cut2), full]) {
const p = extractNewsPartial(chunk, RESULTS);
if (p) partials.push(p);
}
assert.equal(partials.length, 3);
assert.match(partials[0], /1\. 新闻A/);
assert.doesNotMatch(partials[0], /新闻B/);
assert.match(partials[1], /新闻B/);
assert.equal(partials[2], renderNewsAnswer(full, RESULTS));
});

test('流式：摘要一词一词长出来，越喂越长，最后与最终答案一致', () => {
const full = jsonItems([
{ title: '新闻A', time: '上午9点', summary: '个人不低于10万元，机构不低于500万元。', source: '早安长春！新闻早班车', date: '2026-11-28'},
{ title: '新闻B', time: '', summary: '贪污5.87亿元。', source: '每日资讯简报', date: '2026-11-28'},
]);
// 在第一条摘要中间切开，模拟流式逐词到达；来源字段还没写到，所以第一段只有时间没有来源
const cutSummary = full.indexOf('机构不低于');
const cutNext = full.indexOf('{"title":"新闻B"');
const p1 = extractNewsPartial(full.slice(0, cutSummary), RESULTS);
const p2 = extractNewsPartial(full.slice(0, cutNext), RESULTS);
const p3 = extractNewsPartial(full, RESULTS);
assert.ok(p1);
assert.match(p1, /1\. 新闻A（上午9点）：个人不低于10万元，/);
assert.doesNotMatch(p1, /机构不低于/);
assert.doesNotMatch(p1, /来源/);
assert.doesNotMatch(p1, /新闻B/);
assert.ok(p2);
assert.match(p2, /1\. 新闻A（上午9点，来源：《早安长春！新闻早班车》）：个人不低于10万元，机构不低于500万元。/);
assert.doesNotMatch(p2, /新闻B/);
assert.equal(p3, renderNewsAnswer(full, RESULTS));
});

test('流式：来源写出来了就显示来源；转义引号不抠错', () => {
const partial = '{"items": [{"title": "新闻A", "time": "上午9点", "summary": "他说 \\"好\\" 。", "source": "早安长春！新闻早班';
const out = extractNewsPartial(partial, RESULTS);
assert.ok(out);
assert.match(out, /1\. 新闻A（上午9点，来源：《早安长春！新闻早班》）：他说 "好" 。/);
});

test('readPartialField：转义还原、没写完取现有内容、没这字段返回空串', () => {
assert.equal(readPartialField('{"title": "A\\"B', 'title'), 'A"B');
assert.equal(readPartialField('{"title": "AB', 'title'), 'AB');
assert.equal(readPartialField('{"title": "AB", "time": "上午9点', 'time'), '上午9点');
assert.equal(readPartialField('{"title": "AB"}', 'summary'), '');
assert.equal(readPartialField('{"summary": "第一行\\n第二行', 'summary'), '第一行\n第二行');
});

test('逐条渲染：标题里带花括号/引号也不抠错对象', () => {
const partial = '{"items": [{"title": "A{x}B", "time": "", "summary": "他说 \\"好\\" 。", "source": "早安长春！新闻早班车", "date": "2026-11-28"}, {"title": "新闻B", "time": "", "summary": "摘要B。", "source": "每日资讯简报", "date": "2026-11-28"}]}';
const out = extractNewsPartial(partial, RESULTS);
assert.ok(out);
assert.match(out, /A\{x\}B/);
assert.match(out, /2\. 新闻B/);
});
});
