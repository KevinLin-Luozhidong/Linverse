// 安全回归测试：纯函数逻辑，不碰数据库、不调外部接口
// 跑法：npm test（node --test）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const site = require('../src/routes/site.js')._test;
const providers = require('../src/ai/providers.js')._test;

describe('密码哈希（site.js）', () => {
  it('scrypt 哈希能验证通过，错密码拒绝', () => {
    const h = site.hashPw('my-password-123');
    assert.match(h, /^scrypt:/);
    assert.equal(site.verifyPw('my-password-123', h), true);
    assert.equal(site.verifyPw('wrong-password', h), false);
  });
  it('每次哈希盐随机，同样密码哈希不同', () => {
    assert.notEqual(site.hashPw('same'), site.hashPw('same'));
  });
  it('老 SHA256 哈希兼容验证（自动升级路径）', () => {
    const crypto = require('crypto');
    const legacy = crypto.createHash('sha256').update('linverse-site:' + 'oldpw').digest('hex');
    assert.equal(site.isLegacyHash(legacy), true);
    assert.equal(site.isLegacyHash(site.hashPw('x')), false);
    assert.equal(site.verifyPw('oldpw', legacy), true);
    assert.equal(site.verifyPw('nope', legacy), false);
  });
  it('空密码/空哈希直接拒绝，不抛错', () => {
    assert.equal(site.verifyPw('', site.hashPw('x')), false);
    assert.equal(site.verifyPw('x', ''), false);
    assert.equal(site.verifyPw('x', 'not-a-valid-hash'), false);
  });
  it('safeEqual 定长比较：不等长/空值不抛错', () => {
    assert.equal(site.safeEqual('abc', 'abc'), true);
    assert.equal(site.safeEqual('abc', 'abd'), false);
    assert.equal(site.safeEqual('abc', 'ab'), false);
    assert.equal(site.safeEqual('', 'abc'), false);
  });
});

describe('自定义 AI 接口 SSRF 防护（providers.js）', () => {
  it('拦掉危险协议和云元数据地址', () => {
    for (const u of [
      'ftp://evil.com/v1',
      'file:///etc/passwd',
      'gopher://evil.com/',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0:8080/v1',
      'http://metadata.google.internal/',
      'not-a-url',
    ]) {
      assert.throws(() => providers.assertSafeEndpoint(u), /./, `应拦掉: ${u}`);
    }
  });
  it('放行合法地址（含 Ollama 本地）', () => {
    for (const u of [
      'https://open.bigmodel.cn/api/paas/v4',
      'https://api.openai.com/v1',
      'http://localhost:11434',
      'http://127.0.0.1:11434',
    ]) {
      providers.assertSafeEndpoint(u); // 不抛错即通过
    }
  });
  it('resolveCustomEndpoint 先校验再拼 URL', () => {
    assert.throws(() => providers.resolveCustomEndpoint('http://169.254.169.254/x'));
    const r = providers.resolveCustomEndpoint('https://open.bigmodel.cn/api/paas/v4');
    assert.equal(r.url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.equal(r.format, 'openai');
  });
});
