import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/main/config.js';

const { readConfig, isLoopback, DEFAULT_PORT, DEFAULT_HOST, PUBLIC_HOST } = config;

test('defaults to this machine only', () => {
  const result = readConfig({}, []);
  assert.equal(result.enabled, true);
  assert.equal(result.host, DEFAULT_HOST);
  assert.equal(result.port, DEFAULT_PORT);
  assert.equal(result.loopback, true);
});

test('loopback forms are all recognised', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', 'LOCALHOST']) {
    assert.equal(isLoopback(host), true, host);
  }
  for (const host of ['0.0.0.0', '192.168.1.10', '::', 'example.com']) {
    assert.equal(isLoopback(host), false, host);
  }
});

test('a saved public preference becomes the default host', () => {
  const result = readConfig({}, [], { defaultHost: PUBLIC_HOST });
  assert.equal(result.host, PUBLIC_HOST);
  assert.equal(result.loopback, false);
  assert.equal(result.hostLocked, false, 'a preference is not a lock');
});

test('an explicit host locks out the runtime toggle', () => {
  // An installation launched with a deliberate host must not be overridden by
  // the control-panel button.
  assert.equal(readConfig({ FLAPPER_HOST: '127.0.0.1' }, []).hostLocked, true);
  assert.equal(readConfig({}, ['--host=0.0.0.0']).hostLocked, true);
  assert.equal(readConfig({}, []).hostLocked, false);
});

test('an explicit host beats the saved preference', () => {
  const result = readConfig({ FLAPPER_HOST: '127.0.0.1' }, [], { defaultHost: PUBLIC_HOST });
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.loopback, true);
});

test('binding a public interface is allowed and needs nothing else', () => {
  for (const host of [PUBLIC_HOST, '192.168.1.50', '::']) {
    const result = readConfig({ FLAPPER_HOST: host }, []);
    assert.equal(result.host, host);
    assert.equal(result.loopback, false);
  }
});

test('disabling the server', () => {
  assert.equal(readConfig({ FLAPPER_SERVER: '0' }, []).enabled, false);
  assert.equal(readConfig({}, ['--no-server']).enabled, false);
});

test('argv overrides the environment', () => {
  const result = readConfig({ FLAPPER_PORT: '5000' }, ['--port=6001']);
  assert.equal(result.port, 6001);
});

test('rejects nonsense ports', () => {
  for (const port of ['0', '-1', '70000', 'abc', '80.5']) {
    assert.throws(() => readConfig({ FLAPPER_PORT: port }, []), /invalid port/, port);
  }
});

test('CORS is off unless configured', () => {
  assert.equal(readConfig({}, []).corsOrigin, '');
  assert.equal(readConfig({ FLAPPER_CORS_ORIGIN: 'https://x.test' }, []).corsOrigin, 'https://x.test');
});

test('limits are exposed for the server to enforce', () => {
  const result = readConfig({}, []);
  assert.ok(result.maxBodyBytes > 0);
  assert.ok(result.maxTextLength > 0);
  assert.ok(result.maxRows > 0);
});
