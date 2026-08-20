/**
 * Route handlers as plain (Request, ctx) -> Response functions.
 *
 * The route.ts files under app/api/ are one-line wrappers over these, so the
 * whole API surface can be exercised under `node --test` with a MemoryBroker,
 * an in-memory PGlite, and a `new Request(...)` - no Next, no network.
 *
 * ctx is `{ broker, db, slug, getSession }`. `getSession` is injected
 * (lib/api/next-ctx.ts binds it to Better Auth; tests stub it), which is what
 * keeps auth out of everything testable.
 *
 * Access model:
 *   - writes (message, queue, clear, config) need the board's API key
 *   - reads are open on public boards; on private boards they need the key
 *     (Bearer or ?key=, for displays that cannot send headers) or the owner's
 *     session
 *   - board management (rename, privacy, delete, key rotation) is owner-only
 *
 * A 202 means "validated and delivered to the board's command stream", not
 * "a display is connected" - callers who care check GET /status, whose
 * `stale` field says whether a display has reported recently.
 */

import manifest from '../../public/assets/manifest.json' with { type: 'json' };
import pkg from '../../package.json' with { type: 'json' };
import { json, errorResponse, readJsonBody, reject } from './errors.mjs';
import { LIMITS, textOptions, regionOption, validateConfigPatch } from './validators.mjs';
import { headlessController } from './headless-board.mjs';
import { secretsMatch } from '../broker/tokens.mjs';
import { boardDoc } from './agents-doc.mjs';
import * as boards from '../db/boards.mjs';

export const VERSION = pkg.version;

/** A display that has not posted state for this long counts as disconnected. */
export const STALE_MS = 10_000;

/* ---- shared plumbing ---- */

function origin(request) {
  const url = new URL(request.url);
  // Vercel terminates TLS ahead of the function; trust its forwarded proto so
  // the documented URLs are https, not the internal http.
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) url.protocol = `${proto}:`;
  return url.origin;
}

async function requireBoardBySlug(db, slug) {
  const board = slug && (await boards.getBySlug(db, slug));
  if (!board) reject('unknown board - check the slug, or whether it was renamed or deleted', 404);
  return board;
}

/** The key a caller presented: Authorization Bearer, or ?key= for displays. */
function presentedKey(request) {
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return new URL(request.url).searchParams.get('key') ?? '';
}

async function requireKey(request, board) {
  if (!(await secretsMatch(presentedKey(request), board.apiKey))) {
    reject('this call needs the board’s API key: authorization: Bearer <key>', 401);
  }
}

async function isOwner(board, getSession) {
  const session = await getSession?.();
  return Boolean(session && session.user?.id === board.ownerId);
}

/** Public boards read freely; private ones need the key or the owner. */
async function requireReadAccess(request, board, getSession) {
  if (!board.private) return;
  if (await secretsMatch(presentedKey(request), board.apiKey)) return;
  if (await isOwner(board, getSession)) return;
  reject('this board is private - append ?key=<api key>, send it as a Bearer token, or sign in as its owner', 403);
}

async function requireOwner(board, getSession) {
  const session = await getSession?.();
  if (!session) reject('sign in to manage this board', 401);
  if (session.user?.id !== board.ownerId) reject('only the board’s owner can do this', 403);
  return session;
}

/** Wrap a handler body so a thrown status error becomes its JSON response. */
async function handle(fn) {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

function boardUrls(request, board) {
  const base = origin(request);
  return {
    url: `${base}/b/${board.slug}`,
    apiBase: `${base}/api/b/${board.slug}`,
    docs: `${base}/api/b/${board.slug}/AGENTS.md`,
  };
}

/* ---- board lifecycle (owner) ---- */

export async function createBoard(request, { db, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to create a board', 401);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if (body.name !== undefined && typeof body.name !== 'string') {
      reject('name must be a string', 422);
    }
    const board = await boards.createBoard(db, {
      ownerId: session.user.id,
      name: body.name ?? '',
      slug: body.slug,
    });
    return json(201, {
      boardId: board.id,
      slug: board.slug,
      name: board.name,
      private: board.private,
      apiKey: board.apiKey,
      ...boardUrls(request, board),
    });
  });
}

export async function boardIndex(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const urls = boardUrls(request, board);
    return json(200, {
      service: 'flapper',
      version: VERSION,
      boardId: board.id,
      slug: board.slug,
      name: board.name || undefined,
      private: board.private,
      instructions: urls.docs,
      health: `${urls.apiBase}/health`,
      display: urls.url,
    });
  });
}

export async function boardPatch(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireOwner(board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    for (const key of Object.keys(body)) {
      if (!['name', 'slug', 'private'].includes(key)) {
        reject(`${key} is not a board setting; this route takes name, slug, private`, 422);
      }
    }
    const updated = await boards.updateBoard(db, board.id, body);
    return json(200, {
      ok: true,
      boardId: updated.id,
      slug: updated.slug,
      name: updated.name,
      private: updated.private,
      ...boardUrls(request, updated),
    });
  });
}

export async function boardDelete(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireOwner(board, getSession);
    await boards.deleteBoard(db, board.id);
    await broker.deleteBoard(board.id);
    return json(200, { ok: true });
  });
}

export async function rotateKey(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireOwner(board, getSession);
    const updated = await boards.rotateKey(db, board.id);
    // The old key stopped working with that statement; say so plainly.
    return json(200, { ok: true, apiKey: updated.apiKey });
  });
}

/* ---- reads ---- */

function staleness(state) {
  if (!state) return { boardReady: false, stale: true, updatedAt: null };
  const age = Date.now() - state.updatedAt;
  return { boardReady: age <= STALE_MS, stale: age > STALE_MS, updatedAt: state.updatedAt };
}

export async function health(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const state = await broker.getState(board.id);
    const { boardReady } = staleness(state);
    return json(200, {
      ok: true,
      version: VERSION,
      boardReady,
      uptimeMs: Math.max(0, Date.now() - new Date(board.createdAt).getTime()),
    });
  });
}

export async function capabilities(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    return json(200, headlessController(manifest, board.config).capabilities());
  });
}

export async function status(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const state = await broker.getState(board.id);
    const meta = staleness(state);
    if (!state) {
      return json(200, {
        showing: null,
        lines: null,
        animating: false,
        queue: [],
        regions: {},
        ...meta,
        note: 'no display has reported yet - open the board URL somewhere',
      });
    }
    return json(200, { ...state.snapshot, ...meta });
  });
}

/* ---- writes: validated here, applied by the display ---- */

async function appendChecked(broker, boardId, cmd) {
  const id = await broker.appendCommand(boardId, { ...cmd, ts: Date.now() });
  await broker.touch(boardId);
  return id;
}

export async function postMessage(request, { broker, db, slug }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKey(request, board);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const { text, options } = textOptions(body, LIMITS);
    // Region existence answered from the same config the display runs.
    if (options.region !== undefined) {
      headlessController(manifest, board.config).track(options.region);
    }
    const id = await appendChecked(broker, board.id, {
      method: 'enqueue',
      params: { text, options: { ...options, source: 'api' } },
      source: 'api',
    });
    return json(202, { ok: true, id });
  });
}

export async function preview(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    for (const key of ['priority', 'repeat']) {
      if (body[key] !== undefined) {
        reject(`${key} does not apply to preview; preview never queues anything`, 422);
      }
    }
    const { text, options } = textOptions(body, LIMITS);
    const controller = headlessController(manifest, board.config);
    return json(200, controller.preview(text, options));
  });
}

export async function flushQueue(request, { broker, db, slug }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKey(request, board);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const region = regionOption(body);
    if (region !== undefined) headlessController(manifest, board.config).track(region);
    const id = await appendChecked(broker, board.id, {
      method: 'flush',
      params: { region },
      source: 'api',
    });
    // The desktop app returned the removed count synchronously; a
    // fire-and-forget command cannot. The count shows in the next snapshot.
    return json(202, { ok: true, id });
  });
}

export async function clearBoard(request, { broker, db, slug }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKey(request, board);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const region = regionOption(body);
    if (region !== undefined) headlessController(manifest, board.config).track(region);
    const id = await appendChecked(broker, board.id, {
      method: 'clear',
      params: { region },
      source: 'api',
    });
    return json(202, { ok: true, id });
  });
}

export async function patchConfig(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    // The panel-owner path and the API path both land here.
    if (!(await isOwner(board, getSession))) await requireKey(request, board);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    validateConfigPatch(body);
    // Region existence against the *new* geometry when the same patch changes
    // it - one call can add a footer and set its dwell.
    if (body.regions) {
      const merged = { ...board.config, ...body };
      const controller = headlessController(manifest, { ...merged, regions: undefined });
      for (const id of Object.keys(body.regions)) controller.track(id);
    }
    const config = await boards.setConfig(db, board.id, body);
    // Stored for capabilities/preview, and applied live by any connected
    // display via the command stream.
    await appendChecked(broker, board.id, { method: 'configure', params: body, source: 'api' });
    return json(200, { ok: true, config });
  });
}

/* ---- the display's own calls ---- */

export async function postState(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if (body.state === undefined || typeof body.state !== 'object' || body.state === null) {
      reject('body must be {state: <status snapshot>}', 422);
    }
    await broker.setState(board.id, body.state);
    await broker.touch(board.id);
    return json(200, { ok: true });
  });
}

/* ---- streams ---- */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The command feed, as an async generator so the polling policy is testable
 * without streams or timers. Yields `{type:'command', id, cmd}` and
 * `{type:'heartbeat'}`; returns when the window closes or the signal aborts.
 *
 * Time is tracked by accumulated sleep, not the clock: good enough for a
 * window measured in minutes, and deterministic under test.
 */
export async function* commandEvents(broker, boardId, afterId, options = {}) {
  const {
    windowMs = 290_000,
    activeDelayMs = 750,
    idleDelayMs = 3000,
    idleAfterMs = 60_000,
    heartbeatMs = 15_000,
    sleep = defaultSleep,
    signal,
  } = options;

  let cursor = afterId;
  let elapsed = 0;
  let sinceCommand = 0;
  let sinceOutput = 0;

  while (elapsed < windowMs && !signal?.aborted) {
    const entries = await broker.commandsAfter(boardId, cursor, 100);
    if (entries.length > 0) {
      for (const entry of entries) {
        cursor = entry.id;
        yield { type: 'command', id: entry.id, cmd: entry.cmd };
      }
      sinceCommand = 0;
      sinceOutput = 0;
    } else if (sinceOutput >= heartbeatMs) {
      yield { type: 'heartbeat' };
      sinceOutput = 0;
    }
    // Poll briskly while someone is driving the board, lazily when idle.
    const delay = sinceCommand >= idleAfterMs ? idleDelayMs : activeDelayMs;
    await sleep(delay);
    elapsed += delay;
    sinceCommand += delay;
    sinceOutput += delay;
  }
}

/** State changes for observers: poll the snapshot, emit when it moves. */
export async function* stateEvents(broker, boardId, options = {}) {
  const {
    windowMs = 290_000,
    pollMs = 1000,
    heartbeatMs = 15_000,
    sleep = defaultSleep,
    signal,
  } = options;

  let lastUpdatedAt = null;
  let elapsed = 0;
  let sinceOutput = 0;

  while (elapsed < windowMs && !signal?.aborted) {
    const state = await broker.getState(boardId);
    if (state && state.updatedAt !== lastUpdatedAt) {
      lastUpdatedAt = state.updatedAt;
      yield { type: 'state', state: state.snapshot, updatedAt: state.updatedAt };
      sinceOutput = 0;
    } else if (sinceOutput >= heartbeatMs) {
      yield { type: 'heartbeat' };
      sinceOutput = 0;
    }
    await sleep(pollMs);
    elapsed += pollMs;
    sinceOutput += pollMs;
  }
}

function sseResponse(run) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const send = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already gone */
        }
      };
      run(send, close);
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

/** SSE feed a display consumes. Cursor lives client-side via Last-Event-ID. */
export async function commandsStream(request, { broker, db, slug, getSession }) {
  let board;
  try {
    board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
  } catch (error) {
    return errorResponse(error);
  }
  await broker.touch(board.id);

  const url = new URL(request.url);
  const after =
    request.headers.get('last-event-id') ??
    url.searchParams.get('after') ??
    (await broker.latestCommandId(board.id));

  return sseResponse(async (send, close) => {
    // A short retry so a window-end reconnect costs a blink, not seconds.
    send('retry: 1500\n\n');
    for await (const event of commandEvents(broker, board.id, after, { signal: request.signal })) {
      if (event.type === 'command') {
        send(`id: ${event.id}\ndata: ${JSON.stringify(event.cmd)}\n\n`);
      } else {
        send(': keep-alive\n\n');
      }
    }
    close();
  });
}

/** SSE state stream for observers. */
export async function eventsStream(request, { broker, db, slug, getSession }) {
  let board;
  try {
    board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
  } catch (error) {
    return errorResponse(error);
  }

  return sseResponse(async (send, close) => {
    send('retry: 1500\n\n');
    for await (const event of stateEvents(broker, board.id, { signal: request.signal })) {
      if (event.type === 'state') {
        send(`data: ${JSON.stringify(event.state)}\n\n`);
      } else {
        send(': keep-alive\n\n');
      }
    }
    close();
  });
}

/* ---- docs ---- */

export async function agentsDoc(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const body = boardDoc({
      base: origin(request),
      slug: board.slug,
      isPrivate: board.private,
      version: VERSION,
    });
    return new Response(body, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  });
}
