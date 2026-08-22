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

import { RING, NOMINAL_TILE_SIZE } from '../board/ring.mjs';
import { publicConfig, resolveBoardTheme, themeRevOf } from '../board/board-theme.mjs';

/** What the headless board needs to know about the tiles: the ring and the nominal size. */
const TILES = Object.freeze({ cycle: RING, tileSize: NOMINAL_TILE_SIZE });
import pkg from '../../package.json' with { type: 'json' };
import { json, errorResponse, readJsonBody, reject } from './errors.mjs';
import { LIMITS, textOptions, regionOption, validateConfigPatch } from './validators.mjs';
import { headlessController } from './headless-board.mjs';
import { secretsMatch } from '../broker/tokens.mjs';
import { boardDoc } from './agents-doc.mjs';
import * as boards from '../db/boards.mjs';
import { user } from '../db/schema.mjs';
import { eq } from 'drizzle-orm';
import * as queue from '../db/queue.mjs';
import { displayTokenValid } from './display-token.mjs';
import { getBoardType, migratedConfig, BOARD_TYPES } from '../board-types/index.mjs';
import { applyParams, entitled } from '../board-types/contract.mjs';
import { getTemplate, TEMPLATES } from '../board-types/templates.mjs';
import { itemDurationMs } from './durations.mjs';
import { displayHealth } from './liveness.mjs';
import { expiryOf, validateSchedule } from '../board/schedule.mjs';

/** Flat abuse guard, not an entitlement (see entitled() in the type contract). */
const MAX_BOARDS_PER_USER = 25;

const VERSION = pkg.version;

/* ---- shared plumbing ---- */

export function origin(request) {
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

/**
 * Tell this board's displays that the queue or config moved. Best-effort:
 * the write it follows has already happened, and a nudge the realtime
 * service cannot carry is logged, not turned into a failed request.
 */
async function nudge(broker, db, boardId, method = 'sync') {
  const snapshot = await queue.listQueue(db, boardId);
  return bestEffort(async () => {
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
  }, `nudge for board ${boardId}`);
}

/**
 * The paused presentation: a deactivated board, or one whose type this build
 * does not know (failure containment - a broken type darkens one board, not
 * the app). The queue is untouched; settings offers export.
 */
function pausedOf(board) {
  const type = getBoardType(board.type);
  if (board.status !== 'active') {
    return { paused: true, reason: 'this board is deactivated - its queue is kept and exportable' };
  }
  if (!type) {
    return { paused: true, reason: `this board’s type (${board.type}) is not available in this build` };
  }
  return { paused: false };
}

/** The type for a board, or the paused path. Mutations require an active type. */
function requireType(board) {
  const type = getBoardType(board.type);
  if (!type) reject(`this board’s type (${board.type}) is not available; its queue is kept`, 409);
  return type;
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
  const entry = { payload: { text, options }, loop, source };
  // A schedule spec rides along raw; the board's type validates it in ingest
  // (live boards refuse it - a schedule needs a clock to mean anything).
  if (body.schedule !== undefined) entry.schedule = body.schedule;
  return { entry, priority };
}

/**
 * The clock-board timing columns for an item: its slot duration (a pure
 * function of payload + config) and, for `once` specs, the materialized
 * end-of-life the expiry sweep deletes on.
 */
function clockTiming(board, payload, schedule) {
  const computedDurationMs = itemDurationMs(headlessController(TILES, board.config), payload);
  return { computedDurationMs, expiresAtMs: expiryOf(schedule, computedDurationMs) };
}

/** Wrap a handler body so a thrown status error becomes its JSON response. */
async function handle(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error?.status === 503) {
      // The realtime service: the response carries the sentence, the log the provider's detail.
      console.error(`flapper: realtime unavailable - ${error.cause?.message ?? error.message}`);
      return errorResponse(error);
    }
    if (!error?.status) {
      // An unstatused throw is a bug or an outage, not a message for the caller.
      console.error('flapper: unhandled', error);
      return errorResponse({ status: 500, message: 'internal error' });
    }
    return errorResponse(error);
  }
}

/**
 * Run a broker call whose failure must not fail the request - a nudge, a
 * touch. Logged once per call, then forgotten: the queue and the config are
 * already saved, and a display that missed the nudge resyncs when it next
 * reconnects or comes to the foreground.
 */
async function bestEffort(work, what) {
  try {
    await work();
    return true;
  } catch (error) {
    console.error(`flapper: ${what} skipped - ${error.cause?.message ?? error.message}`);
    return false;
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

/** The account's tier ('standard' until a billing source says otherwise). */
async function accountTier(db, userId) {
  const [row] = await db.select({ tier: user.tier }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.tier ?? 'standard';
}

export async function createBoard(request, { broker, db, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to create a board', 401);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if ((await boards.listByOwner(db, session.user.id)).length >= MAX_BOARDS_PER_USER) {
      reject(`accounts hold up to ${MAX_BOARDS_PER_USER} boards; delete one first`, 403);
    }
    // A template is a type plus a starting point: preset params and config,
    // and a seeded queue. The body still wins on anything it names (name,
    // timezone, fallback), so a template is a default, not a lock.
    let template = null;
    if (body.template !== undefined) {
      template = getTemplate(body.template);
      if (!template) {
        reject(`unknown template "${body.template}"; this build has ${[...TEMPLATES.keys()].join(', ')}`, 422);
      }
      if (body.type !== undefined && body.type !== template.type) {
        reject(`template "${template.id}" is a ${template.type} board; leave type out or match it`, 422);
      }
    }
    const typeId = template?.type ?? body.type ?? 'live';
    const type = getBoardType(typeId);
    if (!type) {
      reject(`unknown board type "${typeId}"; this build has ${[...BOARD_TYPES.keys()].join(', ')}`, 422);
    }
    // Entitlement is enforced here, on the path agents take, not in the UI.
    if (!entitled(type, await accountTier(db, session.user.id))) {
      reject(
        `"${type.name}" boards need the ${type.tier} tier; this account is on ${await accountTier(db, session.user.id)}. Upgrade the account, or create a different type.`,
        402,
      );
    }
    // The type's params become the board config; name is board identity.
    const input = { ...(template?.params ?? {}), ...body };
    const config = migratedConfig(type, applyParams(type.createParams, input));
    // A template's display config (grid, theme, alignment) rides on top,
    // checked as a PATCH /config body would be.
    if (template && Object.keys(template.config).length > 0) {
      validateConfigPatch(template.config);
      Object.assign(config, template.config);
    }
    type.validateConfig?.(config);
    const name = config.name ?? '';
    delete config.name;
    const board = await boards.createBoard(db, {
      ownerId: session.user.id,
      name,
      slug: body.slug,
      type: type.id,
      config,
    });
    // The seeds, through the same door as any API post. Nothing is watching
    // a board this new, but a nudge costs nothing and keeps the broker honest.
    if (template && template.seed.length > 0) {
      for (const seed of template.seed) await admit(db, board, type, seed, 'template');
      if (broker) await nudge(broker, db, board.id);
    }
    // No apiKey here. Creation is usually an agent's call, and a key in the
    // tool result is a key in the transcript and every log of it. The key is
    // an explicit, separate ask: get_board_key / GET {apiBase}/key, or the
    // board's settings page.
    return json(201, {
      boardId: board.id,
      slug: board.slug,
      name: board.name,
      type: board.type,
      private: board.private,
      ...(template ? { template: template.id, seeded: template.seed.length } : {}),
      ...boardUrls(request, board),
    });
  });
}

/** The signed-in user's boards. No apiKey here - get_board_key is the
 * explicit per-board escalation, so this list is safe to quote anywhere. */
export async function listBoards(request, { db, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to list your boards', 401);
    const owned = await boards.listByOwner(db, session.user.id);
    return json(200, {
      boards: owned.map((board) => ({
        slug: board.slug,
        name: board.name,
        type: board.type,
        status: board.status,
        private: board.private,
        ...boardUrls(request, board),
      })),
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
      type: board.type,
      status: board.status,
      private: board.private,
      instructions: urls.docs,
      health: `${urls.apiBase}/health`,
      display: urls.url,
    });
  });
}

export async function boardPatch(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireOwner(board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    for (const key of Object.keys(body)) {
      if (!['name', 'slug', 'private', 'status'].includes(key)) {
        reject(`${key} is not a board setting; this route takes name, slug, private, status`, 422);
      }
    }
    const updated = await boards.updateBoard(db, board.id, body);
    if (body.status !== undefined) await nudge(broker, db, board.id);
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

/** The current key, for the owner - the read half of rotateKey below. */
export async function getBoardKey(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireOwner(board, getSession);
    return json(200, { slug: board.slug, apiKey: board.apiKey });
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

/** stale / frozen / boardReady - the shared rule in ./liveness.mjs. */
const staleness = (state) => displayHealth(state);

export async function health(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    let state = null;
    let realtime = 'ok';
    try {
      state = await broker.getState(board.id);
    } catch (error) {
      if (error?.status !== 503) throw error;
      console.error(`flapper: realtime unavailable - ${error.cause?.message ?? error.message}`);
      realtime = 'unavailable';
    }
    const { boardReady, frozen } = staleness(state);
    return json(200, {
      ok: realtime === 'ok',
      version: VERSION,
      // 'unavailable' means the service that relays display state is down:
      // boardReady is then unknown, reported false, and the reason is here.
      realtime,
      boardReady,
      frozen,
      uptimeMs: Math.max(0, Date.now() - new Date(board.createdAt).getTime()),
    });
  });
}

export async function capabilities(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    return json(200, headlessController(TILES, board.config).capabilities());
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

/**
 * Admit one message body to a board's queue: validate it, let the type
 * decide where it lands, store it. The one door for API posts and template
 * seeds alike, so a seed can never do what a caller would be refused.
 */
async function admit(db, board, type, body, source) {
  const parsed = entryFromBody(body, source);

  if (parsed.entry.schedule !== undefined && type.playback !== 'clock') {
    reject('this board type has no clock; schedule only applies to scheduled boards', 422);
  }

  // The type decides what now/next/normal mean and may reshape the entry.
  const snapshot = await queue.listQueue(db, board.id);
  let { entry, placement } = type.ingest(parsed.priority, parsed.entry, {
    snapshot,
    config: migratedConfig(type, board.config),
    nowMs: Date.now(),
  });
  if (type.playback === 'clock') {
    entry = { ...entry, ...clockTiming(board, entry.payload, entry.schedule) };
  }
  const { item } =
    placement === 'now'
      ? await queue.setNow(db, board.id, entry)
      : placement === 'next'
        ? await queue.insertAfterCurrent(db, board.id, entry)
        : await queue.appendItem(db, board.id, entry);
  return item;
}

export async function postMessage(request, { broker, db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const type = requireType(board);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const item = await admit(db, board, type, body, 'api');
    await nudge(broker, db, board.id);
    // `position` is the item's place in the queue, 1-based, as a person would
    // count it - the ordering key underneath (a float with gaps) reads like
    // "2048th in line" and stays internal. `ahead` is how many play first.
    const { items } = await queue.listQueue(db, board.id);
    const index = items.findIndex((entry) => entry.id === item.id);
    return json(202, {
      ok: true,
      id: item.id,
      position: index >= 0 ? index + 1 : null,
      ahead: index >= 0 ? index : null,
      loop: item.loop,
      ...(item.schedule ? { schedule: item.schedule } : {}),
    });
  });
}

/* ---- the queue itself ---- */

export async function getQueue(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const type = getBoardType(board.type);
    let snapshot = await queue.listQueue(db, board.id);
    let extras = {};
    if (type && type.playback === 'clock') {
      try {
        // Expired one-shots (materialized expiresAtMs) leave on read, so the
        // schedule list never accretes played-out items.
        if ((await queue.sweepExpired(db, snapshot.queueId, Date.now())) > 0) {
          snapshot = await queue.listQueue(db, board.id);
        }
        extras = type.snapshotExtras(board, snapshot, Date.now()) ?? {};
      } catch (error) {
        // Failure containment: a broken type darkens this board only.
        console.error(`flapper: type ${board.type} failed - ${error.message}`);
        extras = {};
        board.status = 'deactivated';
      }
    }
    // The theme pack is not here - see getTheme - but its revision is, so a
    // display knows when to go and get it.
    const config = publicConfig(type ? migratedConfig(type, board.config) : board.config);
    return json(200, {
      type: board.type,
      themeRev: await themeRevOf(board.config),
      playback: type?.playback ?? 'live',
      status: board.status,
      ...pausedOf(board),
      currentItemId: snapshot.currentItemId,
      currentState: snapshot.currentState,
      epoch: snapshot.epoch,
      queueUpdatedAt: new Date(snapshot.queueUpdatedAt).getTime(),
      serverNowMs: Date.now(),
      ...extras,
      items: snapshot.items.map(publicItem),
      config,
    });
  });
}

function publicItem(item) {
  return {
    id: item.id,
    payload: item.payload,
    loop: item.loop,
    source: item.source,
    computedDurationMs: item.computedDurationMs ?? null,
    schedule: item.schedule ?? null,
    createdAt: new Date(item.createdAt).getTime(),
    updatedAt: new Date(item.updatedAt).getTime(),
  };
}

export async function patchQueueItem(request, { broker, db, slug, itemId, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const type = requireType(board);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const patch = {};
    if (body.text !== undefined || body.rows !== undefined) {
      const { entry } = entryFromBody(body, 'api');
      patch.payload = entry.payload;
    }
    if (body.loop !== undefined) patch.loop = body.loop;
    if (body.schedule !== undefined) {
      if (type.playback !== 'clock') {
        reject('this board type has no clock; schedule only applies to scheduled boards', 422);
      }
      patch.schedule = validateSchedule(body.schedule);
    }
    if (Object.keys(patch).length === 0) {
      reject('nothing to change; this route takes text or rows, loop, and schedule', 422);
    }
    if (type.playback === 'clock' && (patch.payload || patch.schedule)) {
      // The slot length follows the payload; a once item's expiry follows both.
      const items = (await queue.listQueue(db, board.id)).items;
      const existing = items.find((item) => item.id === itemId);
      if (!existing) reject('unknown queue item', 404);
      Object.assign(
        patch,
        clockTiming(board, patch.payload ?? existing.payload, patch.schedule ?? existing.schedule),
      );
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
    if ((getBoardType(board.type)?.playback ?? 'live') !== 'live') {
      return json(200, { ok: true, advanced: false, playback: 'clock' });
    }
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
    const controller = headlessController(TILES, board.config);
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
    const raw = await readJsonBody(request, LIMITS.maxBodyBytes);
    const body = validateConfigPatch(raw, board.config);
    // Bands are deferred: a footer cannot be configured into existence, and
    // per-band settings have no band to land on.
    if (Number(body.footerRows) > 0) {
      reject('multi-band boards return in a future release; footerRows must be 0 for now', 422);
    }
    if (body.regions && Object.keys(body.regions).some((id) => id !== 'main')) {
      reject('multi-band boards return in a future release; only main exists', 422);
    }
    const type = getBoardType(board.type);
    // A patched key the type declares as a param (queueCap, timezone…) is
    // validated by that param's schema, exactly as at creation, and the
    // coerced value is what gets stored - never the raw body.
    let patch = body;
    if (type) {
      const declared = type.createParams.filter((param) => param.key !== 'name' && param.key in body);
      if (declared.length > 0) patch = { ...body, ...applyParams(declared, body) };
    }
    type?.validateConfig?.({ ...board.config, ...patch });
    const config = await boards.setConfig(db, board.id, patch);
    // Slot durations are a function of (payload, config): a config change on
    // a clock board recuts every slot, so recompute what actually moved.
    if (type?.playback === 'clock') {
      const fresh = { ...board, config };
      const { items } = await queue.listQueue(db, board.id);
      for (const item of items) {
        const timing = clockTiming(fresh, item.payload, item.schedule);
        if (
          timing.computedDurationMs !== item.computedDurationMs ||
          timing.expiresAtMs !== item.expiresAtMs
        ) {
          await queue.updateItem(db, board.id, item.id, timing);
        }
      }
    }
    await nudge(broker, db, board.id);
    return json(200, { ok: true, config, themeRev: await themeRevOf(config) });
  });
}

/**
 * The theme a board's displays draw: the preset, the board's overrides, and
 * the resolved pack. Served apart from /queue so the pack - which can carry
 * inline art - does not ride along with every queue poll; `rev` is the
 * display's cue to refetch, and the ETag, so a display that already has it
 * gets a 304.
 */
export async function getTheme(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    const rev = await themeRevOf(board.config);
    const etag = `"${rev}"`;
    const headers = { etag, 'cache-control': 'no-cache' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    const { id, pack, themePack, warnings } = resolveBoardTheme(board.config);
    return new Response(JSON.stringify({ theme: id, themePack, pack, rev, warnings }, null, 2), {
      status: 200,
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    });
  });
}

/* ---- deactivation & export ---- */

/** The board's items in a paste-able shape - the deactivation escape hatch. */
export async function exportQueue(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const snapshot = await queue.listQueue(db, board.id);
    return json(200, {
      board: { slug: board.slug, name: board.name, type: board.type },
      exportedAt: Date.now(),
      items: snapshot.items.map((item) => ({
        payload: item.payload,
        loop: item.loop,
        ...(item.schedule ? { schedule: item.schedule } : {}),
      })),
    });
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
    // A stale mirror replaying an old item must not rewrite the truth. Only
    // meaningful in live mode - a timed board's head is the clock, not a row.
    const playing = body.state.playingItemId;
    if (playing !== undefined && playing !== null && playing !== board.currentItemId) {
      if ((getBoardType(board.type)?.playback ?? 'live') === 'live') {
        return json(200, { ok: true, ignored: 'stale item' });
      }
    }
    // setState carries its own TTL and the command key is touched when a
    // display connects its stream; a touch here too would double the cost of
    // the display's five-second heartbeat for nothing.
    await broker.setState(board.id, body.state);
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
    // Idle is the normal state of a wall: a display that has not heard a
    // command for a minute polls at this cadence. Every poll is a Redis
    // command, so this number is most of the realtime bill.
    idleDelayMs = 8000,
    idleAfterMs = 60_000,
    heartbeatMs = 15_000,
    outageDelayMs = 20_000,
    sleep = defaultSleep,
    signal,
  } = options;

  let cursor = afterId;
  let elapsed = 0;
  let sinceCommand = 0;
  let sinceOutput = 0;

  let failing = false;
  while (elapsed < windowMs && !signal?.aborted) {
    let entries;
    try {
      entries = await broker.commandsAfter(boardId, cursor, 100);
      failing = false;
    } catch (error) {
      // A broker outage must not drop the connection: a display that
      // reconnects every second is the one thing that makes an over-quota
      // service worse. Hold the stream open, back off, try again.
      if (!failing) console.error(`flapper: command stream paused - ${error.cause?.message ?? error.message}`);
      failing = true;
      yield { type: 'heartbeat' };
      sinceOutput = 0;
      await sleep(outageDelayMs);
      elapsed += outageDelayMs;
      sinceCommand += outageDelayMs;
      continue;
    }
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
    pollMs = 3000,
    heartbeatMs = 15_000,
    outageDelayMs = 20_000,
    sleep = defaultSleep,
    signal,
  } = options;

  let lastUpdatedAt = null;
  let elapsed = 0;
  let sinceOutput = 0;
  let failing = false;

  while (elapsed < windowMs && !signal?.aborted) {
    let state;
    try {
      state = await broker.getState(boardId);
      failing = false;
    } catch (error) {
      if (!failing) console.error(`flapper: state stream paused - ${error.cause?.message ?? error.message}`);
      failing = true;
      yield { type: 'heartbeat' };
      sinceOutput = 0;
      await sleep(outageDelayMs);
      elapsed += outageDelayMs;
      continue;
    }
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
      type: getBoardType(board.type),
    });
    return new Response(body, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  });
}
