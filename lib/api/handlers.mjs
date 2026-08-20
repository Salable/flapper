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
import * as queue from '../db/queue.mjs';
import { getUserTier, boardLimitFor } from '../db/entitlements.mjs';
import { displayTokenValid } from './display-token.mjs';

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

/** Queue writes accept the API key or the owner's session (the Settings path). */
async function requireKeyOrOwner(request, board, getSession) {
  if (await isOwner(board, getSession)) return;
  await requireKey(request, board);
}

/**
 * The display's write-backs (advance, state) accept the display token, the
 * API key, or the owner's session - but never plain read access: a public
 * board's audience can watch, not fast-forward.
 */
async function requireDisplay(request, board, getSession) {
  const presented = presentedKey(request);
  if (await displayTokenValid(presented, board)) return;
  if (await secretsMatch(presented, board.apiKey)) return;
  if (await isOwner(board, getSession)) return;
  reject('this call needs the board’s display token or API key', 401);
}

/** Tell every connected display that the queue or config moved. */
async function nudge(broker, db, boardId, method = 'sync') {
  const snapshot = await queue.listQueue(db, boardId);
  await broker.appendCommand(boardId, {
    method,
    params: snapshot
      ? {
          currentItemId: snapshot.currentItemId,
          currentState: snapshot.currentState,
          epoch: snapshot.epoch,
          queueUpdatedAt: new Date(snapshot.queueUpdatedAt).getTime(),
        }
      : {},
    source: 'api',
  });
  await broker.touch(boardId);
}

/**
 * Bands are deferred to a future release: the queue model is single-band, so
 * anything addressing another region is refused rather than misplayed.
 */
function rejectBands(options) {
  if (options.region !== undefined && options.region !== 'main') {
    reject('multi-band boards return in a future release; omit region for now', 422);
  }
  delete options.region;
}

/** The queue entry a validated message body becomes. */
function entryFromBody(body, source) {
  const { text, options } = textOptions(body, LIMITS);
  rejectBands(options);
  // `loop` is the new name; `repeat` is accepted as its 1.x/2.0 alias. Either
  // way it lives on the queue item, never in the payload the display plays.
  let loop = options.repeat === true;
  delete options.repeat;
  if (body.loop !== undefined) {
    if (typeof body.loop !== 'boolean') reject('loop must be true or false', 422);
    loop = body.loop;
  }
  const priority = options.priority ?? 'normal';
  delete options.priority;
  return { entry: { payload: { text, options }, loop, source }, priority };
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
    const tier = await getUserTier(db, session.user.id);
    const limit = boardLimitFor(tier);
    if ((await boards.listByOwner(db, session.user.id)).length >= limit) {
      reject(`the ${tier} tier allows ${limit} boards; delete one, or upgrade to Plus`, 403);
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
    const [state, snapshot] = await Promise.all([
      broker.getState(board.id),
      queue.listQueue(db, board.id),
    ]);
    const meta = staleness(state);
    // The server queue is the plan; the display snapshot is the glass. Both
    // are served: `queue` no longer depends on a display being connected.
    const queueTruth = {
      queue: {
        currentItemId: snapshot.currentItemId,
        currentState: snapshot.currentState,
        epoch: snapshot.epoch,
        length: snapshot.items.length,
        items: snapshot.items.map((item) => ({
          id: item.id,
          loop: item.loop,
          text: item.payload.text ?? null,
        })),
      },
    };
    if (!state) {
      return json(200, {
        showing: null,
        lines: null,
        animating: false,
        regions: {},
        ...queueTruth,
        ...meta,
        note: 'no display has reported yet - open the board URL somewhere',
      });
    }
    return json(200, { ...state.snapshot, ...queueTruth, ...meta });
  });
}

/* ---- writes: validated here, applied by the display ---- */

export async function postMessage(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const { entry, priority } = entryFromBody(body, 'api');
    const { item } =
      priority === 'now'
        ? await queue.setNow(db, board.id, entry)
        : priority === 'next'
          ? await queue.insertAfterCurrent(db, board.id, entry)
          : await queue.appendItem(db, board.id, entry);
    await nudge(broker, db, board.id);
    return json(202, { ok: true, id: item.id, position: item.position, loop: item.loop });
  });
}

/* ---- the queue itself ---- */

export async function getQueue(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const snapshot = await queue.listQueue(db, board.id);
    return json(200, {
      currentItemId: snapshot.currentItemId,
      currentState: snapshot.currentState,
      epoch: snapshot.epoch,
      queueUpdatedAt: new Date(snapshot.queueUpdatedAt).getTime(),
      items: snapshot.items.map(publicItem),
      config: board.config,
    });
  });
}

function publicItem(item) {
  return {
    id: item.id,
    payload: item.payload,
    loop: item.loop,
    source: item.source,
    createdAt: new Date(item.createdAt).getTime(),
    updatedAt: new Date(item.updatedAt).getTime(),
  };
}

export async function patchQueueItem(request, { broker, db, slug, itemId, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const patch = {};
    if (body.text !== undefined || body.rows !== undefined) {
      const { entry } = entryFromBody(body, 'api');
      patch.payload = entry.payload;
    }
    if (body.loop !== undefined) patch.loop = body.loop;
    if (Object.keys(patch).length === 0) {
      reject('nothing to change; this route takes text or rows, and loop', 422);
    }
    const updated = await queue.updateItem(db, board.id, itemId, patch);
    await nudge(broker, db, board.id);
    return json(200, { ok: true, item: publicItem(updated) });
  });
}

export async function deleteQueueItem(request, { broker, db, slug, itemId, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    await queue.removeItem(db, board.id, itemId);
    await nudge(broker, db, board.id);
    return json(200, { ok: true });
  });
}

export async function reorderQueue(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if (typeof body.itemId !== 'string') reject('itemId must be a queue item id', 422);
    if (body.afterId !== null && typeof body.afterId !== 'string') {
      reject('afterId must be a queue item id, or null for the front of the pending queue', 422);
    }
    await queue.reorderItem(db, board.id, body.itemId, body.afterId);
    await nudge(broker, db, board.id);
    return json(200, { ok: true });
  });
}

/** A display finished (or failed) its current item. Idempotent per play. */
export async function advanceQueue(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireDisplay(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if (typeof body.itemId !== 'string') reject('itemId must be the played item’s id', 422);
    const epoch = Number(body.epoch);
    if (!Number.isInteger(epoch)) reject('epoch must be the integer from the queue snapshot', 422);
    const result = await queue.advance(db, board.id, body.itemId, epoch, {
      error: body.error,
    });
    // Mirrors learn about the new head from the nudge, not by finishing.
    if (result.advanced) await nudge(broker, db, board.id);
    return json(200, {
      ok: true,
      advanced: result.advanced,
      current: result.current ? publicItem(result.current) : null,
      currentState: result.currentState,
      epoch: result.epoch,
      queueUpdatedAt: new Date(result.queueUpdatedAt).getTime(),
    });
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

export async function flushQueue(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    rejectBands({ region: regionOption(body) });
    // The queue is server-side again, so the removed count is synchronous
    // truth - the 2.0 fire-and-forget caveat is gone.
    const removed = await queue.flushPending(db, board.id);
    await nudge(broker, db, board.id);
    return json(200, { ok: true, removed });
  });
}

export async function clearBoard(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    rejectBands({ region: regionOption(body) });
    const removed = await queue.clearQueue(db, board.id);
    await nudge(broker, db, board.id, 'clear');
    return json(200, { ok: true, removed });
  });
}

export async function patchConfig(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    validateConfigPatch(body);
    // Bands are deferred: a footer cannot be configured into existence, and
    // per-band settings have no band to land on.
    if (Number(body.footerRows) > 0) {
      reject('multi-band boards return in a future release; footerRows must be 0 for now', 422);
    }
    if (body.regions && Object.keys(body.regions).some((id) => id !== 'main')) {
      reject('multi-band boards return in a future release; only main exists', 422);
    }
    const config = await boards.setConfig(db, board.id, body);
    // Stored for capabilities/preview; connected displays refetch on the nudge.
    await nudge(broker, db, board.id);
    return json(200, { ok: true, config });
  });
}

/* ---- the display's own calls ---- */

export async function postState(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    // A write, not a read: a public board's audience must not be able to
    // rewrite what /status reports.
    await requireDisplay(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if (body.state === undefined || typeof body.state !== 'object' || body.state === null) {
      reject('body must be {state: <status snapshot>}', 422);
    }
    // A stale mirror replaying an old item must not rewrite the truth.
    const playing = body.state.playingItemId;
    if (playing !== undefined && playing !== null && playing !== board.currentItemId) {
      return json(200, { ok: true, ignored: 'stale item' });
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
