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
import { validatePack } from '../board/theme-pack.mjs';
import { THEMES, THEME_IDS, isTheme, resolveTheme } from '../board/themes.mjs';
import {
  publicConfig,
  resolveBoardTheme,
  themeRevOf,
  checkThemePackLimits,
  sparsify,
} from '../board/board-theme.mjs';

/** What the headless board needs to know about the tiles: the ring and the nominal size. */
const TILES = Object.freeze({ cycle: RING, tileSize: NOMINAL_TILE_SIZE });
import pkg from '../../package.json' with { type: 'json' };
import { json, errorResponse, readJsonBody, reject } from './errors.mjs';
import { LIMITS, textOptions, regionOption, validateConfigPatch, validateInterrupterPreset } from './validators.mjs';
import { gridFor } from '../board/geometry.mjs';
import { headlessController } from './headless-board.mjs';
import { secretsMatch } from '../broker/tokens.mjs';
import { boardDoc } from './agents-doc.mjs';
import * as boards from '../db/boards.mjs';
import * as queue from '../db/queue.mjs';
import * as designsDb from '../db/designs.mjs';
import { displayTokenValid } from './display-token.mjs';
import { getBoardType, migratedConfig, BOARD_TYPES } from '../board-types/index.mjs';
import { applyParams } from '../board-types/contract.mjs';
import { getTemplate, TEMPLATES } from '../board-types/templates.mjs';
import { itemDurationMs } from './durations.mjs';
import { displayHealth } from './liveness.mjs';
import { expiryOf, validateSchedule } from '../board/schedule.mjs';
import { MAX_DWELL_MS } from '../board/track.mjs';
import { sharedLicence, REQUESTABLE, ENTITLEMENTS, getInTouchUrl } from '../salable/licence.mjs';
import * as licenceRequests from '../db/licence-requests.mjs';
import { notifyGetInTouch } from './get-in-touch.mjs';

/**
 * The abuse ceiling for a build with no Salable account behind it, where
 * nothing else stops a runaway script. A licensed build takes its number
 * from the account's allowance instead - `boards_unlimited` means unlimited,
 * or the entitlement is a lie.
 */
const MAX_BOARDS_UNLICENSED = 25;



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
  // How long from now until this item is gone outright, not just "not
  // currently up" - an interrupter's "until dismissed" vs "expires in 3
  // minutes", so an unattended one does not stand forever. Materialized
  // to a wall-clock instant here, at admit time, on the server's own
  // clock - never trust a caller's "in 3 minutes" against its own clock.
  if (body.expiresInMs !== undefined) {
    const ms = Number(body.expiresInMs);
    if (!Number.isFinite(ms) || ms <= 0) reject('expiresInMs must be a positive number', 422);
    entry.expiresAtMs = Date.now() + ms;
  }
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

/**
 * What a board that named no template gets instead - every curated
 * template already seeds something, so this is only for the registry's own
 * "blank" cards and a bare `POST /api/boards`. A board with nothing on it
 * is a black rectangle with no clue why; one line that says what to do
 * about that is a better first impression than silence. Keyed by
 * `playback`, not type id, so a future live-playback type gets this for
 * free. No entry for `clock` - a scheduled item needs an actual schedule
 * shape, and a text-only guess would just be wrong.
 */
const DEFAULT_SEED = { live: [{ text: 'PUT TEXT IN ME', loop: true }] };

/**
 * What this account may do. Salable's answer, never Flapper's: there is no
 * ladder and no cached tier column here, only the question and the reply.
 */
async function allowanceFor(ctx, userId) {
  return (ctx.licence ?? sharedLicence()).allowanceFor(userId);
}

/**
 * The 402 body. Every limit ends the same way, because every paid plan is
 * bespoke: there is no price list to send anyone to, so the route out is a
 * conversation. `need` is what the caller was refused, which the in-app form
 * pre-fills and the get-in-touch inbox sorts on.
 */
const OFF_THE_SHELF = 'get in touch and we will cut you a plan';

function refuseUnlicensed(what, need) {
  reject(
    `${what}. This account holds no Flapper licence - sign out and back in, or contact support`,
    403,
    { need },
  );
}

export async function createBoard(request, ctx) {
  const { broker, db, getSession } = ctx;
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to create a board', 401);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    /*
     * The paywall. One place, on the path REST and the MCP create_board tool
     * both take - a greyed-out card in the UI is decoration, this is the
     * gate. Three questions, all answered by Salable: is there a licence at
     * all, is this type included, and how many boards does it cover.
     *
     * In that order, and it matters. Somebody at their one-board limit asking
     * for a scheduled board needs two things, and "delete one first" sends
     * them to delete a board and hit a second refusal. The type is a fact
     * about the request and the count is a fact about the account, so the
     * more specific answer goes first.
     */
    const allowance = await allowanceFor(ctx, session.user.id);
    if (!allowance.licensed) {
      refuseUnlicensed('a board needs a licence', ENTITLEMENTS.createBoard);
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
    // A type that costs money names the entitlement it needs; the account
    // either holds it or does not. `types: null` is the unlicensed build,
    // where every type this build has is free.
    if (type.entitlement && allowance.types && !allowance.types.includes(type.id)) {
      reject(
        `"${type.name}" boards are not on this licence. A live queue board is included; ${OFF_THE_SHELF}.`,
        402,
        { need: type.entitlement, getInTouch: `${origin(request)}${getInTouchUrl(type.entitlement)}` },
      );
    }
    const held = (await boards.listByOwner(db, session.user.id)).length;
    const ceiling = Number.isFinite(allowance.maxBoards)
      ? allowance.maxBoards
      : allowance.source === 'unlicensed'
        ? MAX_BOARDS_UNLICENSED
        : Infinity;
    if (held >= ceiling) {
      if (allowance.source === 'unlicensed') {
        reject(`accounts hold up to ${MAX_BOARDS_UNLICENSED} boards; delete one first`, 403);
      }
      reject(
        `this licence covers ${ceiling} board${ceiling === 1 ? '' : 's'} and ${held} ${held === 1 ? 'is' : 'are'} in use. Delete one, or ${OFF_THE_SHELF}.`,
        402,
        { need: 'boards', getInTouch: `${origin(request)}${getInTouchUrl('boards')}` },
      );
    }
    // The type's params become the board config; name is board identity.
    const input = { ...(template?.params ?? {}), ...body };
    const config = migratedConfig(type, applyParams(type.createParams, input));
    // How many slides a board can hold at once is the licence's ceiling on
    // top of the type's own range (1-50 on a live board) - only types that
    // declare queueCap are affected, everything else leaves config.queueCap
    // undefined and skips both branches. Asking for more than the licence
    // covers is a refusal, like every other gate; landing on more than it
    // covers because that's just the type's own default is a silent clamp,
    // the same as MAX_BOARDS_UNLICENSED is - nobody chose that number.
    if (config.queueCap !== undefined && Number.isFinite(allowance.maxQueueItems)) {
      if (input.queueCap !== undefined && Number(input.queueCap) > allowance.maxQueueItems) {
        reject(
          `this licence covers ${allowance.maxQueueItems} slide${allowance.maxQueueItems === 1 ? '' : 's'} per board. ${OFF_THE_SHELF}.`,
          402,
          { need: 'queue_slots', getInTouch: `${origin(request)}${getInTouchUrl('queue_slots')}` },
        );
      }
      config.queueCap = Math.min(config.queueCap, allowance.maxQueueItems);
    }
    // A template's display config (grid, theme, alignment) rides on top,
    // checked as a PATCH /config body would be.
    if (template && Object.keys(template.config).length > 0) {
      validateConfigPatch(template.config);
      Object.assign(config, template.config);
    }
    /*
     * A grid is never stored. A board records the two facts it is designed
     * from - the screen and the card size - and cols x rows is worked out from
     * them wherever it is needed. Anything that arrives carrying a grid is
     * dropped rather than kept: a stored number outlives the template it came
     * from, drifts away from the screen it was meant for, and then two boards
     * are different shapes for a reason nobody can point at.
     */
    delete config.cols;
    delete config.rows;
    // ...but a template is a default, not a lock, so a caller who names a
    // design gets it. This is how "make a board in this" from /designs works,
    // and it is the same for an agent that asks for a theme by name.
    if (body.theme !== undefined) {
      validateConfigPatch({ theme: body.theme });
      config.theme = body.theme;
    }
    // A design of your own arrives as an id and lands as a pack. The board
    // stores what it was given rather than a reference, so editing or deleting
    // the design later cannot reach a wall - and the display keeps resolving
    // themes purely, with no database read on the drawing path.
    if (body.designId !== undefined) {
      const design = await designsDb.getDesign(db, session.user.id, String(body.designId));
      if (!design) reject('no design of that id on this account', 422);
      /*
       * Stored the way every other path stores a board's look: as a diff
       * against the board's own preset, with art nothing references dropped.
       *
       * Checked after that, not before. A design and a board's override are
       * held to different limits - a design may be 256 KB, a board's pack 64 KB
       * with eight arts - and checking the dense pack meant a design could be
       * refused here while the very same design applied through Settings
       * sparsified under the cap and went through. Same design, same board, two
       * answers depending on which door you came in by.
       */
      const preset = resolveTheme(config.theme);
      const sparse = sparsify(design.pack, preset);
      const fits = checkThemePackLimits(sparse);
      if (!fits.ok) {
        reject(
          `"${design.name}" is too large for a board to wear: ${fits.errors.join('; ')}`,
          fits.tooLarge ? 413 : 422,
        );
      }
      config.themePack = sparse;
    }
    // Remember where the board came from. A template sets things a board then
    // carries for ever - Match day makes a 24-column board - and without this
    // there is nothing anywhere that can say why, which is exactly how a
    // reasonable default comes to look like a bug on the dashboard.
    if (template) config.template = template.id;
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
    // `seed: false` is the explicit opt out - a caller building a board up
    // by hand (the test suite's own `makeBoard`, chiefly) asking for a
    // truly empty queue rather than the friendly default. It only silences
    // the *default* - a template that was actually asked for still seeds
    // what it always did; naming one is not "no template" with extra steps.
    const seed = template?.seed?.length > 0 ? template.seed : body.seed === false ? null : DEFAULT_SEED[type.playback];
    if (seed) {
      for (const item of seed) await admit(db, board, type, item, 'template');
      if (broker) await nudge(broker, db, board.id);
    }
    // No apiKey here. Creation is usually an agent's call, and a key in the
    // tool result is a key in the transcript and every log of it. The key is
    // an explicit, separate ask: get_board_key / GET {apiBase}/key, or the
    // board's manage page.
    return json(201, {
      boardId: board.id,
      slug: board.slug,
      name: board.name,
      type: board.type,
      private: board.private,
      ...(template ? { template: template.id } : {}),
      // `seed` above already accounts for both cases - a template's own
      // seed, or (absent one) the default placeholder - so this stays
      // accurate instead of going quiet the moment there's no template to
      // credit it to.
      ...(seed ? { seeded: seed.length } : {}),
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

export async function boardPatch(request, ctx) {
  const { broker, db, slug, getSession } = ctx;
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    const session = await requireOwner(board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    for (const key of Object.keys(body)) {
      if (!['name', 'slug', 'private', 'status'].includes(key)) {
        reject(`${key} is not a board setting; this route takes name, slug, private, status`, 422);
      }
    }
    // Going private is an entitlement; coming back public never is, so an
    // account that loses the licence can still undo what it did with it.
    if (body.private === true && !board.private) {
      const allowance = await allowanceFor(ctx, session.user.id);
      if (!allowance.privateBoards) {
        reject(
          `private boards are not on this licence, so it stays readable by anyone with its URL. ${OFF_THE_SHELF[0].toUpperCase()}${OFF_THE_SHELF.slice(1)}.`,
          402,
          {
            need: ENTITLEMENTS.privateBoard,
            getInTouch: `${origin(request)}${getInTouchUrl(ENTITLEMENTS.privateBoard)}`,
          },
        );
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
  if (parsed.entry.expiresAtMs !== undefined && type.playback === 'clock') {
    reject('expiresInMs does not apply here; a scheduled item already expires with its own schedule', 422);
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
    } else if (type && type.playback === 'live') {
      // Same lazy sweep, for an interrupter given "expires in N minutes"
      // instead of "until dismissed" - a live board has no clock ticking
      // it forward on its own, so a read is the only moment there is.
      if ((await queue.sweepExpiredLive(db, board.id, Date.now())) > 0) {
        snapshot = await queue.listQueue(db, board.id);
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
    expiresAtMs: item.expiresAtMs ?? null,
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
    if (body.expiresInMs !== undefined) {
      if (type.playback === 'clock') {
        reject('expiresInMs does not apply here; a scheduled item already expires with its own schedule', 422);
      }
      // null clears it back to "until dismissed"; anything else re-bases
      // the countdown from now, same as setting it fresh.
      if (body.expiresInMs === null) {
        patch.expiresAtMs = null;
      } else {
        const ms = Number(body.expiresInMs);
        if (!Number.isFinite(ms) || ms <= 0) {
          reject('expiresInMs must be a positive number, or null to clear it', 422);
        }
        patch.expiresAtMs = Date.now() + ms;
      }
    }
    if (Object.keys(patch).length === 0) {
      reject('nothing to change; this route takes text or rows, loop, schedule, and expiresInMs', 422);
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

export async function patchConfig(request, ctx) {
  const { broker, db, slug, getSession } = ctx;
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
    // The owner's licence, not the caller's - an agent driving the board on
    // an API key has no session to check, and the ceiling is a fact about
    // the account either way (see the watermark's same reasoning).
    if (body.queueCap !== undefined) {
      const allowance = await allowanceFor(ctx, board.ownerId);
      if (Number.isFinite(allowance.maxQueueItems) && Number(body.queueCap) > allowance.maxQueueItems) {
        reject(
          `this licence covers ${allowance.maxQueueItems} slide${allowance.maxQueueItems === 1 ? '' : 's'} per board. ${OFF_THE_SHELF}.`,
          402,
          { need: 'queue_slots', getInTouch: `${origin(request)}${getInTouchUrl('queue_slots')}` },
        );
      }
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

/* ---- saved interrupters: name it once, fire it by name later ---- */

/** However many a board keeps around - not a rotation, so not the type's
 * own queueCap; just a sane ceiling on a list someone is meant to read. */
const MAX_INTERRUPTERS = 20;

/** Everything saved, board config's own way - `PATCH /config` already owns
 * this shape of storage, `interrupters` is just one more field of it. */
export async function listInterrupters(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireReadAccess(request, board, getSession);
    return json(200, { interrupters: board.config?.interrupters ?? [] });
  });
}

/**
 * Save one - create or, naming an existing one again, replace it outright
 * (editing is re-saving, not a separate PATCH). What gets fired later is
 * exactly what was saved here: there is no path from typed text straight
 * to the glass any more, on purpose - see fireInterrupter below.
 */
export async function saveInterrupter(request, ctx) {
  const { db, slug, getSession } = ctx;
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const preset = validateInterrupterPreset(body);
    // The owner's licence, not the caller's - same reasoning as the
    // watermark and the queue-slot ceiling: an agent driving the board on
    // an API key has no session to check, and the limit is a fact about
    // the account either way. Read once, outside the transaction, since
    // it's the same answer whichever branch below needs it.
    const allowance = await allowanceFor(ctx, board.ownerId);
    const ceiling = Number.isFinite(allowance.maxInterrupters) ? allowance.maxInterrupters : MAX_INTERRUPTERS;
    const config = await boards.updateInterrupters(db, board.id, (existing) => {
      const index = existing.findIndex((item) => item.name.toLowerCase() === preset.name.toLowerCase());
      if (index >= 0) {
        const interrupters = existing.slice();
        interrupters[index] = preset;
        return interrupters;
      }
      if (existing.length >= MAX_INTERRUPTERS) {
        reject(`this board already has ${MAX_INTERRUPTERS} saved interrupters; remove one first`, 422);
      }
      if (existing.length >= ceiling) {
        reject(
          `this licence covers ${ceiling} interrupter${ceiling === 1 ? '' : 's'} per board. ${OFF_THE_SHELF}.`,
          402,
          { need: 'interrupters', getInTouch: `${origin(request)}${getInTouchUrl('interrupters')}` },
        );
      }
      return [...existing, preset];
    });
    return json(200, { interrupters: config.interrupters });
  });
}

export async function deleteInterrupter(request, { db, slug, name, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const config = await boards.updateInterrupters(db, board.id, (existing) => {
      const interrupters = existing.filter((item) => item.name.toLowerCase() !== name.toLowerCase());
      if (interrupters.length === existing.length) reject('no saved interrupter of that name', 404);
      return interrupters;
    });
    return json(200, { interrupters: config.interrupters });
  });
}

/**
 * Fire one, by name - the one door from a saved interrupter to the glass.
 * Builds exactly the body composing one by hand would (`priority: "now"`,
 * `interrupt: true`, this preset's own Duration, translated to `dwellMs`/
 * `expiresInMs` here at fire time), and posts it through `admit`, the same
 * as any other message. `label` is the preset's own name, so the rail can
 * tell which saved interrupter is the one currently playing without a
 * second identifier to keep in step - and so this check can too: if
 * what's currently showing is itself a saved interrupter ranked ahead of
 * this one (earlier in the rail), the fire is refused outright rather
 * than breaking it. Rank is enforced here and only here - a raw
 * `{"interrupt": true, "priority": "now"}` straight to `/message`,
 * bypassing the saved system entirely, still pre-empts unconditionally,
 * same as it always has.
 */
export async function fireInterrupter(request, { broker, db, slug, name, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const type = requireType(board);
    const presets = board.config?.interrupters ?? [];
    const index = presets.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
    if (index < 0) reject('no saved interrupter of that name', 404);
    const preset = presets[index];

    const { items, currentItemId } = await queue.listQueue(db, board.id);
    const current = items.find((item) => item.id === currentItemId);
    if (current?.payload?.options?.interrupt === true) {
      const currentName = String(current.payload.options.label ?? '');
      const currentIndex = presets.findIndex((item) => item.name.toLowerCase() === currentName.toLowerCase());
      if (currentIndex >= 0 && currentIndex < index) {
        reject(
          `"${presets[currentIndex].name}" is showing and ranks ahead of "${preset.name}" - move "${preset.name}" above it, or wait for "${presets[currentIndex].name}"'s own turn`,
          409,
        );
      }
    }

    const body = { priority: 'now', interrupt: true, label: preset.name };
    // Content is text (+ optional align/valign) or rows, the same either-or
    // validateInterrupterPreset itself enforces at save time - never both,
    // so at most one of these branches ever adds anything.
    if (preset.rows !== undefined) {
      body.rows = preset.rows;
    } else {
      body.text = preset.text;
      if (preset.align !== undefined) body.align = preset.align;
      if (preset.valign !== undefined) body.valign = preset.valign;
    }
    if (preset.durationMs !== undefined) {
      // A hard limit: shown, then gone outright the instant it's up,
      // whichever comes first between that and its own turn ending.
      body.dwellMs = preset.durationMs;
      body.expiresInMs = preset.durationMs;
    } else {
      // The switch: blocks the rotation entirely - the longest dwell the
      // engine allows, and no expiry, so nothing but a dismiss or a
      // higher-ranked interrupter ends it.
      body.dwellMs = MAX_DWELL_MS;
    }
    const item = await admit(db, board, type, body, 'api');
    await nudge(broker, db, board.id);
    return json(202, { ok: true, id: item.id });
  });
}

/**
 * End a fired interrupter by name - the "until dismissed" counterpart to
 * `fireInterrupter`. Removes every queued instance carrying this name as
 * `label`, current or pending, not just whichever one is on the glass:
 * firing the same preset more than once queues a second copy behind the
 * first rather than replacing it, and dismissing only the head would just
 * promote an identical clone into its place. No 404 for "nothing to
 * dismiss" - a name with no live instance is not an error, just a no-op.
 */
export async function dismissInterrupter(request, { broker, db, slug, name, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const { removed } = await queue.removeByLabel(db, board.id, name);
    if (removed > 0) await nudge(broker, db, board.id);
    return json(200, { ok: true, removed });
  });
}

/**
 * Reorder the saved list - the rail's own tab order, which is the whole of
 * how one saved interrupter outranks another (see docs/QUEUES.md: no rank
 * field exists any more, order is the only signal). Takes the full desired
 * order as names rather than a single move, the same reasoning `/queue/
 * reorder` doesn't: at a cap of 20 there is no gap-exhaustion problem a
 * `{itemId, afterId}` shape exists to solve, and a caller building a whole
 * ordering (or a UI's own Move earlier/later, computed client-side) can
 * just send the end state directly.
 */
export async function reorderInterrupters(request, { db, slug, getSession }) {
  return handle(async () => {
    const board = await requireBoardBySlug(db, slug);
    await requireKeyOrOwner(request, board, getSession);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    if (!Array.isArray(body.names) || body.names.some((name) => typeof name !== 'string')) {
      reject('names must be an array of every saved interrupter\'s name', 422);
    }
    const config = await boards.updateInterrupters(db, board.id, (existing) => {
      // Matched the same case-insensitive way save/delete/fire look a name
      // up - this was the one spot still comparing exact case, so a client
      // that echoes a name back in a different case (or just a
      // case-insensitive caller) got a false "no saved interrupter named"
      // 422 even though the preset was right there.
      const byName = new Map(existing.map((item) => [item.name.toLowerCase(), item]));
      const keys = body.names.map((name) => name.toLowerCase());
      if (body.names.length !== existing.length || new Set(keys).size !== existing.length) {
        reject('names must name each saved interrupter exactly once', 422);
      }
      return keys.map((key, i) => {
        const item = byName.get(key);
        if (!item) reject(`no saved interrupter named "${body.names[i]}"`, 422);
        return item;
      });
    });
    return json(200, { interrupters: config.interrupters });
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

/* ---- designs: the theme packs an account made ---- */

/** A design's name: something a person can tell apart in a list. */
function designName(value, { required = true } = {}) {
  if (value === undefined) {
    if (required) reject('a design needs a name', 422);
    return undefined;
  }
  // Refused, not coerced. String(null) is "null" and String({}) is
  // "[object Object]", so a caller sending the wrong shape would have got a
  // design named after its own mistake - and this file's rule everywhere else
  // is that a typo is a 422 rather than something silently accepted.
  if (typeof value !== 'string') reject('a design name must be text', 422);
  const name = value.trim();
  if (name === '') reject('a design needs a name', 422);
  if (name.length > 60) reject('a design name is at most 60 characters', 422);
  return name;
}

/**
 * The pack a caller sent, validated.
 *
 * The same door for the designer and for an agent: `validatePack` names every
 * problem it finds rather than stopping at the first, so an LLM that posts a
 * near-miss can read the errors and fix its own pack.
 */
function designPack(value) {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    // Name the thing that actually works. GET /api/designs lists the shipped
    // presets but only their names - an agent told to copy one would find no
    // pack there - and there is no /api/designs/presets at all.
    reject(
      'pack must be a theme pack object; to start from one that ships, send { from: "classic" } instead of a pack',
      422,
    );
  }
  const result = validatePack({ ...value, id: undefined });
  if (!result.ok) reject(result.errors.join('; '), 422);
  return result.pack;
}

/** Every design this account made, plus the ones that ship. */
export async function listDesignsHandler(request, { db, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to see your designs', 401);
    return json(200, {
      designs: await designsDb.listDesigns(db, session.user.id),
      presets: THEME_IDS.map((id) => ({ id, name: THEMES[id].name, description: THEMES[id].description })),
      limit: designsDb.MAX_DESIGNS,
    });
  });
}

/**
 * Make one. `basedOn` is a note about where it started, never resolved - a
 * shipped theme id, or the id of one of the caller's own designs. Either
 * way it is copied in, not linked: editing the new one later never reaches
 * whatever it started from.
 */
export async function createDesignHandler(request, { db, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to make a design', 401);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const name = designName(body.name);
    // Starting from a shipped design is the common case, so it is one field
    // rather than a pack somebody had to fetch and paste back - and the same
    // field also takes one of your own designs, so "a variant of this one"
    // does not mean re-entering every slider from scratch.
    const from = body.from === undefined ? null : String(body.from);
    let startPack = null;
    if (from !== null) {
      if (isTheme(from)) {
        startPack = resolveTheme(from);
      } else {
        const source = await designsDb.getDesign(db, session.user.id, from);
        if (!source) {
          reject(`unknown design "${from}"; not a shipped theme (${THEME_IDS.join(', ')}) or one of yours`, 422);
        }
        startPack = source.pack;
      }
    }
    const pack = body.pack === undefined && startPack !== null ? startPack : designPack(body.pack);
    const made = await designsDb.createDesign(db, {
      ownerId: session.user.id,
      name,
      pack: { ...pack, id: undefined, name: undefined, description: undefined },
      basedOn: from,
    });
    return json(201, { design: made });
  });
}

/** One of yours. */
export async function getDesignHandler(request, { db, designId, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to read your designs', 401);
    const design = await designsDb.getDesign(db, session.user.id, designId);
    if (!design) reject('no design of that id on this account', 404);
    return json(200, { design });
  });
}

/** Rename it, repack it, or both. */
export async function updateDesignHandler(request, { db, designId, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to change a design', 401);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const patch = {};
    if (body.name !== undefined) patch.name = designName(body.name, { required: false });
    if (body.pack !== undefined) patch.pack = designPack(body.pack);
    if (Object.keys(patch).length === 0) reject('send a name, a pack, or both', 422);
    const updated = await designsDb.updateDesign(db, session.user.id, designId, patch);
    if (!updated) reject('no design of that id on this account', 404);
    return json(200, { design: updated });
  });
}

/**
 * Delete it. Boards wearing it are untouched: a board stores the pack it was
 * given, so nothing on a wall depends on this row still existing.
 */
export async function deleteDesignHandler(request, { db, designId, getSession }) {
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to delete a design', 401);
    const gone = await designsDb.deleteDesign(db, session.user.id, designId);
    if (!gone) reject('no design of that id on this account', 404);
    return json(200, { deleted: designId });
  });
}

/* ---- get in touch: the other end of a 402 ---- */

/** What a person may type at us, and how much of it. */
const LICENCE_REQUEST = Object.freeze({ maxMessage: 2000, maxContact: 200 });

/**
 * A refusal, answered.
 *
 * There is no checkout to send anyone to - every paid plan is bespoke, by
 * design - so a limit ends in a conversation and this is how it starts. Three
 * things, which is all a bespoke plan needs: what you hit (`need`, the same
 * value the 402 carried), what you need it for, and a better address than the
 * account's if you have one.
 *
 * `need` is a closed list, so a request arrives already sorted into the
 * entitlement a plan would grant rather than as prose someone has to read
 * and classify.
 */
export async function requestLicence(request, ctx) {
  const { db, getSession } = ctx;
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to ask about a plan', 401);
    const body = await readJsonBody(request, LIMITS.maxBodyBytes);
    const need = typeof body.need === 'string' ? body.need : '';
    if (!Object.hasOwn(REQUESTABLE, need)) {
      reject(`need must be one of ${Object.keys(REQUESTABLE).join(', ')}`, 422);
    }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message === '') reject('say what you need it for - it is what we price against', 422);
    if (message.length > LICENCE_REQUEST.maxMessage) {
      reject(`message exceeds ${LICENCE_REQUEST.maxMessage} characters`, 413);
    }
    const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
    if (contact.length > LICENCE_REQUEST.maxContact) {
      reject(`contact exceeds ${LICENCE_REQUEST.maxContact} characters`, 413);
    }
    // Asking twice for the same thing is the same person hitting the same
    // wall, not a second lead. Told plainly, rather than silently deduped -
    // otherwise it reads as the form having done nothing.
    const open = await licenceRequests.openRequestFor(db, session.user.id, need);
    if (open) {
      return json(200, {
        ok: true,
        alreadyOpen: true,
        request: open,
        message: 'that ask is already with us; we will come back to you on it',
      });
    }
    const saved = await licenceRequests.createRequest(db, {
      userId: session.user.id,
      need,
      message,
      contact: contact === '' ? null : contact,
    });
    // Committed first, announced after: a webhook that is down must not lose
    // somebody's ask.
    await bestEffort(
      () =>
        notifyGetInTouch({
          need,
          label: REQUESTABLE[need],
          email: session.user.email,
          contact: saved.contact,
          message: saved.message,
          requestedAt: saved.createdAt,
        }),
      'get-in-touch notification',
    );
    return json(201, {
      ok: true,
      request: saved,
      message: 'thanks - we read these ourselves and will come back to you',
    });
  });
}

/** This account's own asks, and what may be asked for. Powers /account/licence. */
export async function listLicenceRequests(request, ctx) {
  const { db, getSession } = ctx;
  return handle(async () => {
    const session = await getSession?.();
    if (!session) reject('sign in to see your plan requests', 401);
    return json(200, {
      requestable: REQUESTABLE,
      requests: await licenceRequests.listRequestsFor(db, session.user.id),
    });
  });
}
