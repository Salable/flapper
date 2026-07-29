import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/**
 * The REST surface, driven over real HTTP.
 *
 * `server.js` deliberately has no Electron dependency of its own - it reaches
 * the renderer through `bridge.js`, and `bridge.call` is a plain writable
 * export looked up at call time. So the whole routing and validation layer can
 * be exercised outside Electron by swapping that one function, which is what
 * this file does. Everything past the bridge is the controller's business and
 * is covered in controller.test.mjs.
 */

const require = createRequire(import.meta.url);
const bridge = require('../src/main/bridge.js');
const { readConfig } = require('../src/main/config.js');
const { createServer } = require('../src/main/server.js');

const realCall = bridge.call;
const realReady = bridge.ready;

/**
 * Start a server on an ephemeral port with the bridge stubbed.
 * @param {object} t the test context, for cleanup
 * @param {(method, params) => any} handler stands in for the renderer
 */
async function serve(t, handler = () => ({})) {
  const calls = [];
  bridge.ready = () => true;
  bridge.call = async (method, params) => {
    calls.push({ method, params });
    return handler(method, params);
  };

  const config = readConfig({}, []);
  const server = createServer(config, '0.0.0-test');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  t.after(() => {
    bridge.call = realCall;
    bridge.ready = realReady;
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  });

  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };

  return { call, calls, config };
}

/* ---- liveness and discovery ---- */

test('health reports the version and whether the board is ready', async (t) => {
  const { call } = await serve(t);
  const { status, body } = await call('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.version, '0.0.0-test');
  assert.equal(body.boardReady, true);
});

test('the root points at the agent guide', async (t) => {
  const { call } = await serve(t);
  const { status, body } = await call('GET', '/');
  assert.equal(status, 200);
  assert.match(body.instructions, /\/AGENTS\.md$/);
});

/* ---- forwarding ---- */

test('a message is forwarded to the renderer and stamped as api', async (t) => {
  const { call, calls } = await serve(t, () => ({ id: 'm1', pages: 1 }));
  const { status, body } = await call('POST', '/api/message', { text: 'HELLO' });

  assert.equal(status, 202, 'queued, not merely accepted');
  assert.equal(body.id, 'm1');
  assert.deepEqual(calls[0], {
    method: 'enqueue',
    params: { text: 'HELLO', options: { source: 'api' } },
  });
});

test('a caller cannot claim a message came from the UI', async (t) => {
  const { call, calls } = await serve(t);
  await call('POST', '/api/message', { text: 'HELLO', source: 'ui' });
  assert.equal(calls[0].params.options.source, 'api');
});

test('region and priority reach the renderer in both text and rows mode', async (t) => {
  const { call, calls } = await serve(t);
  await call('POST', '/api/message', { text: 'HI', region: 'footer', priority: 'next' });
  await call('POST', '/api/message', { rows: ['AB'], region: 'footer', priority: 'now' });

  assert.equal(calls[0].params.options.region, 'footer');
  assert.equal(calls[0].params.options.priority, 'next');
  assert.equal(calls[1].params.options.region, 'footer');
  assert.equal(calls[1].params.options.priority, 'now');
  assert.deepEqual(calls[1].params.options.rows, ['AB']);
});

test('clear and queue take an optional region, and mean every band without one', async (t) => {
  const { call, calls } = await serve(t, () => 3);

  const cleared = await call('POST', '/api/clear', { region: 'main' });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body, { removed: 3 });
  assert.deepEqual(calls[0], { method: 'clear', params: { region: 'main' } });

  await call('DELETE', '/api/queue', { region: 'footer' });
  assert.deepEqual(calls[1], { method: 'flush', params: { region: 'footer' } });

  await call('DELETE', '/api/queue');
  assert.equal(calls[2].params.region, undefined, 'a bare flush means every band');
});

/* ---- validation ---- */

test('an unknown enum is refused with the list of what is allowed', async (t) => {
  const { call } = await serve(t);
  for (const [body, pattern] of [
    [{ text: 'X', priority: 'urgent' }, /priority must be one of normal, next, now/],
    [{ text: 'X', align: 'middle' }, /align must be one of left, center, right/],
    [{ text: 'X', valign: 'centre' }, /valign must be one of top, middle, bottom/],
    [{ text: 'X', wrap: 'wordy' }, /wrap must be one of word, char, none/],
  ]) {
    const result = await call('POST', '/api/message', body);
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.match(result.body.error, pattern);
  }
});

test('layout options are refused alongside rows rather than ignored', async (t) => {
  const { call } = await serve(t);
  for (const key of ['align', 'valign', 'wrap', 'collapseSpaces']) {
    const result = await call('POST', '/api/message', { rows: ['AB'], [key]: 'left' });
    assert.equal(result.status, 422, key);
    assert.match(result.body.error, new RegExp(`^${key} does not apply when rows is given`));
  }
});

test('rows must be an array of strings', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('POST', '/api/message', { rows: 'AB' })).status, 422);
  assert.equal((await call('POST', '/api/message', { rows: [1, 2] })).status, 422);
  assert.equal((await call('POST', '/api/message', { rows: ['AB', null] })).status, 202);
});

test('an empty region is refused', async (t) => {
  const { call } = await serve(t);
  const result = await call('POST', '/api/message', { text: 'X', region: '  ' });
  assert.equal(result.status, 422);
  assert.match(result.body.error, /region must be a non-empty string/);
});

test('preview refuses priority, because it never queues anything', async (t) => {
  const { call } = await serve(t);
  const result = await call('POST', '/api/preview', { text: 'X', priority: 'now' });
  assert.equal(result.status, 422);
  assert.match(result.body.error, /priority does not apply to preview/);
});

test('preview accepts a region, so it can size against the right band', async (t) => {
  const { call, calls } = await serve(t, () => ({ pages: [], diagnostics: {} }));
  const result = await call('POST', '/api/preview', { text: 'X', region: 'footer' });
  assert.equal(result.status, 200);
  assert.equal(calls[0].params.options.region, 'footer');
});

test('footerRows must be a non-negative integer', async (t) => {
  const { call } = await serve(t, () => ({}));
  for (const value of [-2, 1.5, 'two', null]) {
    const result = await call('PATCH', '/api/config', { footerRows: value });
    assert.equal(result.status, 422, String(value));
    assert.match(result.body.error, /footerRows must be a non-negative integer/);
  }
  assert.equal((await call('PATCH', '/api/config', { footerRows: 2 })).status, 200);
});

/* ---- transport-level errors ---- */

test('a malformed body is a 400, not a 500', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('POST', '/api/message', '{oops')).status, 400);
  assert.equal((await call('POST', '/api/message', '[1,2]')).status, 400);
});

test('an oversized body is refused before it is parsed', async (t) => {
  const { call, config } = await serve(t);
  const huge = 'A'.repeat(config.maxBodyBytes + 1024);
  const result = await call('POST', '/api/message', { text: huge });
  assert.equal(result.status, 413);
});

test('text longer than the limit is refused', async (t) => {
  const { call, config } = await serve(t);
  const result = await call('POST', '/api/message', { text: 'A'.repeat(config.maxTextLength + 1) });
  assert.equal(result.status, 413);
});

test('an unknown route answers with the routes that do exist', async (t) => {
  const { call } = await serve(t);
  const { status, body } = await call('GET', '/api/nope');
  assert.equal(status, 404);
  assert.ok(body.routes.includes('GET /api/status'), 'should list the real routes');
});

test('a known path with the wrong method is a 404', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('PUT', '/api/message', { text: 'X' })).status, 404);
});

/* ---- errors from the renderer ---- */

test('a status thrown by the controller survives to the response', async (t) => {
  const { call } = await serve(t, () => {
    const error = new Error('queue is full (500 messages)');
    error.status = 429;
    throw error;
  });
  const { status, body } = await call('POST', '/api/message', { text: 'X' });
  assert.equal(status, 429, 'not a 500');
  assert.match(body.error, /queue is full/);
});

test('an error with no status is a 500', async (t) => {
  const { call } = await serve(t, () => {
    throw new Error('something came apart');
  });
  const { status, body } = await call('GET', '/api/status');
  assert.equal(status, 500);
  assert.match(body.error, /something came apart/);
});

test('a board that is not ready answers 503', async (t) => {
  const { call } = await serve(t);
  // Put the real bridge back so its own readiness guard runs.
  bridge.call = realCall;
  bridge.ready = () => false;
  const { status, body } = await call('GET', '/api/status');
  assert.equal(status, 503);
  assert.match(body.error, /not ready/);
});

test('repeat must be a boolean, not something coerced into one', async (t) => {
  const { call, calls } = await serve(t);
  for (const value of ['true', 'false', 1, 0, null]) {
    const result = await call('POST', '/api/message', { text: 'X', repeat: value });
    assert.equal(result.status, 422, JSON.stringify(value));
    assert.match(result.body.error, /repeat must be true or false/);
  }
  assert.equal((await call('POST', '/api/message', { text: 'X', repeat: true })).status, 202);
  assert.equal(calls.at(-1).params.options.repeat, true);
});

test('repeat reaches the renderer in rows mode too', async (t) => {
  const { call, calls } = await serve(t);
  await call('POST', '/api/message', { rows: ['AB'], repeat: true });
  assert.equal(calls[0].params.options.repeat, true);
});

test('preview refuses repeat as well as priority', async (t) => {
  const { call } = await serve(t);
  const result = await call('POST', '/api/preview', { text: 'X', repeat: true });
  assert.equal(result.status, 422);
  assert.match(result.body.error, /repeat does not apply to preview/);
});

test('per-band settings are shape-checked before they reach the renderer', async (t) => {
  const { call } = await serve(t, () => ({}));
  for (const [body, pattern] of [
    [{ regions: [] }, /regions must be an object keyed by region id/],
    [{ regions: null }, /regions must be an object keyed by region id/],
    [{ regions: { footer: 5 } }, /regions\.footer must be an object/],
    [{ regions: { footer: { align: 'left' } } }, /regions\.footer\.align is not a per-band setting/],
    [{ regions: { footer: { dwellMs: -1 } } }, /regions\.footer\.dwellMs must be a non-negative/],
    [{ regions: { footer: { dwellMs: 'slow' } } }, /regions\.footer\.dwellMs must be a non-negative/],
  ]) {
    const result = await call('PATCH', '/api/config', body);
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.match(result.body.error, pattern);
  }
});

test('a per-band dwell, and handing it back, are both forwarded', async (t) => {
  const { call, calls } = await serve(t, () => ({}));
  assert.equal(
    (await call('PATCH', '/api/config', { regions: { footer: { dwellMs: 8000 } } })).status,
    200,
  );
  assert.equal(calls[0].params.regions.footer.dwellMs, 8000);

  assert.equal(
    (await call('PATCH', '/api/config', { regions: { footer: { dwellMs: null } } })).status,
    200,
  );
  assert.equal(calls[1].params.regions.footer.dwellMs, null);
});
