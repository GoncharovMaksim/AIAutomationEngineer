import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseProxyList, config } from '../src/config.js';

describe('Config & Proxy Parsing', () => {
  it('returns empty array when proxy string is undefined or empty', () => {
    assert.deepStrictEqual(parseProxyList(undefined), []);
    assert.deepStrictEqual(parseProxyList(''), []);
    assert.deepStrictEqual(parseProxyList('   '), []);
  });

  it('parses host:port proxies without credentials', () => {
    const proxies = parseProxyList('192.168.1.1:8080');
    assert.strictEqual(proxies.length, 1);
    assert.strictEqual(proxies[0].host, '192.168.1.1');
    assert.strictEqual(proxies[0].port, 8080);
    assert.strictEqual(proxies[0].url, 'http://192.168.1.1:8080');
  });

  it('parses host:port:user:pass proxies with authentication', () => {
    const proxies = parseProxyList('45.145.57.233:11319:myUser:mySecretPass');
    assert.strictEqual(proxies.length, 1);
    assert.strictEqual(proxies[0].host, '45.145.57.233');
    assert.strictEqual(proxies[0].port, 11319);
    assert.strictEqual(proxies[0].user, 'myUser');
    assert.strictEqual(proxies[0].pass, 'mySecretPass');
    assert.strictEqual(proxies[0].url, 'http://myUser:mySecretPass@45.145.57.233:11319');
  });

  it('parses multiple comma-separated proxy entries', () => {
    const proxies = parseProxyList('proxy1.com:8080, proxy2.com:3128:user:pass');
    assert.strictEqual(proxies.length, 2);
    assert.strictEqual(proxies[0].host, 'proxy1.com');
    assert.strictEqual(proxies[1].host, 'proxy2.com');
    assert.strictEqual(proxies[1].user, 'user');
  });

  it('marks proxy as failed with temporary cooldown and recovers', () => {
    if (config.proxies.length > 0) {
      const first = config.proxies[0];
      config.markProxyFailed(first.url, 1000);
      assert.ok(first.failedUntil && first.failedUntil > Date.now());
      assert.strictEqual(first.consecutiveFailures, 1);

      // mark success recovers it
      config.markProxySuccess(first.url);
      assert.strictEqual(first.failedUntil, 0);
      assert.strictEqual(first.consecutiveFailures, 0);
    }
  });
});
