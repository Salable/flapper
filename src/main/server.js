'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const bridge = require('./bridge');

/**
 * REST control surface for the board.
 *
 * Deliberately dependency-free: Node's own http module is enough for a handful
 * of JSON routes, and keeping zero runtime dependencies is what makes the .app
 * bundle whitelist trivial.
 *
 * The main process owns the socket and does auth, parsing, and validation;
 * everything past that is forwarded to the renderer's controller, which owns
 * the queue and the board.
 */

const ROUTES = [];
// Parameter is `pathname`, not `path`, so it can't shadow the path module.
function route(method, pathname, handler) {
  ROUTES.push({ method, path: pathname, handler });
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflowed = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (overflowed) return; // draining; keep discarding
      size += chunk.length;
      if (size > limit) {
        overflowed = true;
        chunks.length = 0; // stop holding what we are not going to parse
        // Drain rather than destroy: tearing the socket down here would take
        // the 413 with it, and the caller would see a reset connection instead
        // of the documented status telling them what they did wrong.
        req.resume();
        const error = new Error(`request body exceeds ${limit} bytes`);
        error.status = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const error = new Error('body must be a JSON object');
          error.status = 400;
          reject(error);
          return;
        }
        resolve(parsed);
      } catch {
        const error = new Error('body is not valid JSON');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function reject(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

/**
 * `rows` gives direct, cell-level control: one string per board row, taken
 * literally with no wrapping, alignment, or pagination.
 */
function rowsOption(body, config) {
  const { rows } = body;
  if (rows === undefined) return undefined;
  if (!Array.isArray(rows)) reject('rows must be an array of strings', 422);
  if (rows.length > config.maxRows) {
    reject(`rows exceeds ${config.maxRows} entries`, 413);
  }
  let total = 0;
  for (const row of rows) {
    if (row !== null && typeof row !== 'string') {
      reject('each entry in rows must be a string or null', 422);
    }
    total += row === null ? 0 : row.length;
  }
  if (total > config.maxTextLength) {
    reject(`rows exceed ${config.maxTextLength} characters in total`, 413);
  }
  return rows;
}

const PRIORITIES = ['normal', 'next', 'now'];

/**
 * Where the message lands in the queue. Rejected on preview bodies, which never
 * queue anything, so a caller who expects a jump is told rather than ignored.
 */
function priorityOption(body) {
  if (body.priority === undefined) return undefined;
  if (!PRIORITIES.includes(body.priority)) {
    reject(`priority must be one of ${PRIORITIES.join(', ')}`, 422);
  }
  return body.priority;
}

/**
 * Which band of the board to address.
 *
 * Only the shape is checked here. Whether a band exists depends on how the
 * board is configured right now, which only the renderer knows - it answers
 * with a 422 naming the bands it actually has, so there is one source of truth
 * rather than a list in main that can drift.
 */
function regionOption(body) {
  if (body.region === undefined) return undefined;
  if (typeof body.region !== 'string' || body.region.trim() === '') {
    reject('region must be a non-empty string', 422);
  }
  return body.region;
}

/**
 * Whether a message rejoins its band's queue when it finishes.
 *
 * Strictly boolean, unlike `collapseSpaces` next door which coerces. The
 * failure modes are not comparable: a coerced `"false"` here means a board that
 * cycles forever with no way to stop it short of clearing the band.
 */
function repeatOption(body) {
  if (body.repeat === undefined) return undefined;
  if (typeof body.repeat !== 'boolean') reject('repeat must be true or false', 422);
  return body.repeat;
}

/** Text and layout options accepted on message and preview bodies. */
function textOptions(body, config) {
  const text = body.text === undefined ? '' : String(body.text);
  if (text.length > config.maxTextLength) {
    reject(`text exceeds ${config.maxTextLength} characters`, 413);
  }

  const options = {};
  const rows = rowsOption(body, config);
  if (rows !== undefined) {
    options.rows = rows;
    // Silently ignoring these would look like a bug from the caller's side.
    for (const key of ['align', 'valign', 'wrap', 'collapseSpaces']) {
      if (body[key] !== undefined) {
        reject(`${key} does not apply when rows is given; rows are taken literally`, 422);
      }
    }
    if (body.dwellMs !== undefined) {
      const dwell = Number(body.dwellMs);
      if (!Number.isFinite(dwell) || dwell < 0) reject('dwellMs must be a non-negative number', 422);
      options.dwellMs = dwell;
    }
    if (body.substitutions !== undefined) {
      if (typeof body.substitutions !== 'object' || body.substitutions === null) {
        reject('substitutions must be an object', 422);
      }
      options.substitutions = body.substitutions;
    }
    const rowsPriority = priorityOption(body);
    if (rowsPriority !== undefined) options.priority = rowsPriority;
    const rowsRegion = regionOption(body);
    if (rowsRegion !== undefined) options.region = rowsRegion;
    const rowsRepeat = repeatOption(body);
    if (rowsRepeat !== undefined) options.repeat = rowsRepeat;
    return { text, options };
  }
  for (const [key, allowed] of [
    ['align', ['left', 'center', 'right']],
    ['valign', ['top', 'middle', 'bottom']],
    ['wrap', ['word', 'char', 'none']],
  ]) {
    if (body[key] !== undefined) {
      if (!allowed.includes(body[key])) {
        reject(`${key} must be one of ${allowed.join(', ')}`, 422);
      }
      options[key] = body[key];
    }
  }
  if (body.dwellMs !== undefined) {
    const dwell = Number(body.dwellMs);
    if (!Number.isFinite(dwell) || dwell < 0) {
      reject('dwellMs must be a non-negative number', 422);
    }
    options.dwellMs = dwell;
  }
  if (body.collapseSpaces !== undefined) options.collapseSpaces = Boolean(body.collapseSpaces);
  if (body.substitutions !== undefined) {
    if (typeof body.substitutions !== 'object' || body.substitutions === null) {
      reject('substitutions must be an object', 422);
    }
    options.substitutions = body.substitutions;
  }
  const priority = priorityOption(body);
  if (priority !== undefined) options.priority = priority;
  const region = regionOption(body);
  if (region !== undefined) options.region = region;
  const repeat = repeatOption(body);
  if (repeat !== undefined) options.repeat = repeat;
  return { text, options };
}

/* ---- routes ---- */

// Served at /AGENTS.md, but kept in docs/ so the repo root's AGENTS.md can be
// the guide for someone working *on* this code rather than driving a board.
const AGENTS_PATH = path.join(__dirname, '..', '..', 'docs', 'BOARD-API.md');
// A Host header is attacker-controlled, and it gets substituted into the served
// document, so only accept what a host:port can legitimately contain.
const SAFE_HOST = /^[A-Za-z0-9.\-[\]:]+$/;

function baseUrl(req, config) {
  const host = req.headers.host;
  if (host && SAFE_HOST.test(host)) return `http://${host}`;
  return `http://${config.host}:${config.port}`;
}

/**
 * Instructions for driving the board, aimed at an agent rather than a person.
 */
route('GET', '/AGENTS.md', async (ctx) => {
  let doc;
  try {
    doc = await fs.readFile(AGENTS_PATH, 'utf8');
  } catch {
    json(ctx.res, 404, { error: 'the agent guide is not bundled with this build' });
    return;
  }
  // Rewrite the documented default to whatever this instance actually is, so
  // the examples are copy-pasteable against the board being asked.
  const base = baseUrl(ctx.req, ctx.config);
  const body = doc.split('http://127.0.0.1:4747').join(base);
  const instance = [
    '',
    '---',
    '',
    '## This instance',
    '',
    `- Base URL: \`${base}\``,
    `- Reachable from: ${ctx.config.loopback ? 'this machine only' : '**anywhere on this network**'}`,
    `- Flapper version: ${ctx.version}`,
    `- Display ready: ${bridge.ready() ? 'yes' : 'no'}`,
    '',
  ].join('\n');

  const payload = Buffer.from(body + instance, 'utf8');
  ctx.res.writeHead(200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  ctx.res.end(payload);
});

/** Discovery: point a bare GET at the agent guide. */
route('GET', '/', async (ctx) => {
  json(ctx.res, 200, {
    service: 'flapper',
    version: ctx.version,
    instructions: `${baseUrl(ctx.req, ctx.config)}/AGENTS.md`,
    health: `${baseUrl(ctx.req, ctx.config)}/api/health`,
  });
});

route('GET', '/api/health', async (ctx) => {
  json(ctx.res, 200, {
    ok: true,
    version: ctx.version,
    boardReady: bridge.ready(),
    uptimeMs: Math.round(process.uptime() * 1000),
  });
});

route('GET', '/api/capabilities', async (ctx) => {
  json(ctx.res, 200, await bridge.call('capabilities'));
});

route('GET', '/api/status', async (ctx) => {
  json(ctx.res, 200, await bridge.call('status'));
});

route('POST', '/api/message', async (ctx) => {
  const { text, options } = textOptions(ctx.body, ctx.config);
  const result = await bridge.call('enqueue', { text, options: { ...options, source: 'api' } });
  json(ctx.res, 202, result);
});

route('POST', '/api/preview', async (ctx) => {
  for (const key of ['priority', 'repeat']) {
    if (ctx.body[key] !== undefined) {
      reject(`${key} does not apply to preview; preview never queues anything`, 422);
    }
  }
  const { text, options } = textOptions(ctx.body, ctx.config);
  json(ctx.res, 200, await bridge.call('preview', { text, options }));
});

/** Omitting `region` means every band, so a bare call still clears the board. */
route('DELETE', '/api/queue', async (ctx) => {
  const region = regionOption(ctx.body);
  json(ctx.res, 200, { removed: await bridge.call('flush', { region }) });
});

route('POST', '/api/clear', async (ctx) => {
  const region = regionOption(ctx.body);
  json(ctx.res, 200, { removed: await bridge.call('clear', { region }) });
});

route('PATCH', '/api/config', async (ctx) => {
  // The board clamps a footer to leave the queue a row, but a nonsense value
  // should be refused outright rather than silently becoming something else.
  if (ctx.body.footerRows !== undefined) {
    // `null` is refused explicitly: Number(null) is 0, so it would otherwise
    // pass this check and silently turn the footer off.
    const rows = ctx.body.footerRows === null ? NaN : Number(ctx.body.footerRows);
    if (!Number.isInteger(rows) || rows < 0) {
      reject('footerRows must be a non-negative integer', 422);
    }
  }
  // Per-band settings. Shape is checked here; whether a band exists is the
  // renderer's to answer, since only it knows the current geometry.
  if (ctx.body.regions !== undefined) {
    const bands = ctx.body.regions;
    if (bands === null || typeof bands !== 'object' || Array.isArray(bands)) {
      reject('regions must be an object keyed by region id', 422);
    }
    for (const [id, band] of Object.entries(bands)) {
      if (band === null || typeof band !== 'object' || Array.isArray(band)) {
        reject(`regions.${id} must be an object`, 422);
      }
      for (const key of Object.keys(band)) {
        // Refused rather than ignored: a typo that quietly does nothing is the
        // worst outcome, and this is where per-band align or wrap would land.
        if (key !== 'dwellMs') reject(`regions.${id}.${key} is not a per-band setting`, 422);
      }
      if ('dwellMs' in band && band.dwellMs !== null) {
        const dwell = Number(band.dwellMs);
        if (!Number.isFinite(dwell) || dwell < 0) {
          reject(`regions.${id}.dwellMs must be a non-negative number or null`, 422);
        }
      }
    }
  }
  json(ctx.res, 200, await bridge.call('configure', ctx.body));
});

/** Server-sent events: board state pushed as it changes. */
route('GET', '/api/events', async (ctx) => {
  const { res } = ctx;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    ...(ctx.config.corsOrigin ? { 'access-control-allow-origin': ctx.config.corsOrigin } : {}),
  });
  const send = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  const snapshot = bridge.snapshot();
  if (snapshot) send(snapshot);
  const stop = bridge.watch(send);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  const close = () => {
    clearInterval(beat);
    stop();
  };
  res.on('close', close);
  res.on('error', close);
});

/* ---- server ---- */

function createServer(config, version) {
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      json(res, 400, { error: 'bad request target' });
      return;
    }

    if (config.corsOrigin) {
      res.setHeader('access-control-allow-origin', config.corsOrigin);
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(config.corsOrigin ? 204 : 405).end();
      return;
    }

    const match = ROUTES.find((entry) => entry.method === req.method && entry.path === url.pathname);
    if (!match) {
      const known = [...new Set(ROUTES.map((entry) => `${entry.method} ${entry.path}`))];
      json(res, 404, { error: `no route for ${req.method} ${url.pathname}`, routes: known });
      return;
    }

    try {
      // DELETE carries a body too, so /api/queue can name a band. An empty
      // body still parses to {}, so a bare DELETE is unaffected.
      const body = ['POST', 'PATCH', 'DELETE'].includes(req.method)
        ? await readBody(req, config.maxBodyBytes)
        : {};
      await match.handler({ req, res, url, body, config, version });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, error.status || 500, { error: error.message || 'internal error' });
    }
  });

  return server;
}

/**
 * Start listening. Resolves with `{host, port, url}`, or `null` when the server
 * is disabled.
 */
function start(config, version) {
  if (!config.enabled) return Promise.resolve(null);
  bridge.register();
  const server = createServer(config, version);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const shown = config.loopback ? config.host : address.address;
      resolve({
        server,
        host: address.address,
        port: address.port,
        url: `http://${shown}:${address.port}`,
      });
    });
  });
}

/**
 * Close a running server. SSE clients never disconnect on their own, so their
 * sockets are destroyed explicitly - otherwise `close()` waits forever and a
 * rebind would hang.
 */
function stop(info) {
  return new Promise((resolve) => {
    if (!info || !info.server) {
      resolve();
      return;
    }
    info.server.closeAllConnections?.();
    info.server.close(() => resolve());
  });
}

module.exports = { start, stop, createServer };
