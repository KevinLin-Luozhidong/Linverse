// 站点凭证 cookie 回归测试：纯函数 + 模拟 res，不碰数据库、不调外部接口
// 跑法：npm test（node --test）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const siteAuth = require('../src/siteAuth.js');
const { readSiteToken } = siteAuth._test;

describe('站点凭证读取（siteAuth.js）', () => {
  it('cookie 优先于请求头', () => {
    assert.equal(
      readSiteToken({ headers: { cookie: 'a=1; linverse_site_token=abc123; b=2', 'x-site-token': 'hdr' } }),
      'abc123'
    );
  });
  it('没 cookie 时读 x-site-token 头（老会话兼容）', () => {
    assert.equal(readSiteToken({ headers: { 'x-site-token': 'hdr' } }), 'hdr');
  });
  it('都没有返回空字符串', () => {
    assert.equal(readSiteToken({ headers: {} }), '');
  });
  it('URL 编码的 cookie 值能解码', () => {
    assert.equal(readSiteToken({ headers: { cookie: 'linverse_site_token=ab%20c' } }), 'ab c');
  });
});

describe('站点凭证 cookie 设置（siteAuth.js）', () => {
  it('setSiteCookie：httpOnly + SameSite=Lax + Path=/ + 365 天', () => {
    let captured;
    const res = { cookie: (name, value, opts) => { captured = { name, value, opts }; } };
    siteAuth.setSiteCookie(res, 'tok');
    assert.equal(captured.name, 'linverse_site_token');
    assert.equal(captured.value, 'tok');
    assert.equal(captured.opts.httpOnly, true);
    assert.equal(captured.opts.sameSite, 'lax');
    assert.equal(captured.opts.path, '/');
    assert.equal(captured.opts.maxAge, 365 * 24 * 3600 * 1000);
  });
  it('clearSiteCookie：maxAge 0 立即失效', () => {
    let captured;
    const res = { cookie: (name, value, opts) => { captured = { name, value, opts }; } };
    siteAuth.clearSiteCookie(res);
    assert.equal(captured.name, 'linverse_site_token');
    assert.equal(captured.value, '');
    assert.equal(captured.opts.maxAge, 0);
  });
});
