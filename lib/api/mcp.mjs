/**
 * The MCP face of the service: tool definitions and the bearer verifier for
 * the single global endpoint, POST /api/mcp.
 *
 * Every tool drives the corresponding REST handler with a constructed
 * `Request` - the same trick tests/api.test.mjs uses - so validation, access
 * gates, and behaviour cannot drift from the HTTP surface. This module stays
 * Next-free and Better-Auth-free (the route file owns `mcp-handler`, and the
 * OAuth JWT verifier is injected from lib/auth.ts), which is what keeps it
 * runnable under `node --test`.
 *
 * Two connection modes share the endpoint, told apart by the bearer's shape:
 *
 * - **board**: the bearer is a board's API key (64 hex chars; holding one
 *   *is* the board identity). Every tool drives that one board; tools
 *   re-present the key to their handler, whose own gate runs identically.
 * - **user**: the bearer is an OAuth access token this deployment issued (a
 *   JWT - it has dots). Tools act as the token's user via the handlers'
 *   owner gates (`getSession` is stubbed to that user), each tool takes a
 *   `slug` argument to say which board, and the account tools
 *   (list_boards, create_board, get_board_key) come alive.
 *
 * Board management beyond that (rename, delete, key rotation) is
 * deliberately not a tool in either mode.
 */

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import pkg from '../../package.json' with { type: 'json' };
import * as boards from '../db/boards.mjs';
import { user } from '../db/schema.mjs';
import { isRevoked } from './revocations.mjs';
import {
  origin,
  boardIndex,
  health,
  status,
  capabilities,
  getQueue,
  postMessage,
  preview,
  patchQueueItem,
  deleteQueueItem,
  reorderQueue,
  flushQueue,
  clearBoard,
  patchConfig,
  exportQueue,
  agentsDoc,
  listBoards,
  createBoard,
  getBoardKey,
} from './handlers.mjs';

export const serverInfo = { name: 'flapper', version: pkg.version };

/**
 * What every connecting client is told up front - the part of the board
 * contract that is not obvious from tool schemas alone.
 */
export const serverInstructions = `This server drives Flapper split-flap
display boards - grids of mechanical flip tiles on wall screens. Two ways to
be connected: signed in with a Flapper account (OAuth), where list_boards
shows your boards, create_board makes new ones, and every board tool takes a
slug argument naming the board; or with a single board's API key as the
bearer token, where every tool drives that one board and slug must be
omitted. Board behaviour to honour either way: the character set is limited
(A-Z, 0-9, and a little punctuation; lowercase and accents are folded, some
symbols are dropped), so run preview before posting anything with unusual
characters and report meaningful losses. Posting returns 202 = validated and
queued, not displayed; get_status's boardReady/stale say whether a display is
connected, and its lines field is the glass as last reported. Do not clear a board to
make room (priority "next" jumps the queue without discarding), and do not
reshape the grid without being asked. Boards are public wall glass: never
send secrets or personal data. get_docs returns a board's full guide.`;

/**
 * Board-key half of the verifier: the bearer is some board's API key; the
 * key names the board. A key that matches nothing is `undefined` (a 401
 * challenge) - wrong key and no such board are indistinguishable by design.
 */
export async function verifyBoardKey(db, request, bearerToken) {
  if (!bearerToken) return undefined;
  const board = await boards.getByApiKey(db, bearerToken);
  if (!board) return undefined;
  return {
    token: bearerToken,
    clientId: `board:${board.slug}`,
    scopes: ['board'],
    extra: { mode: 'board', slug: board.slug, origin: origin(request) },
  };
}

async function userExists(db, userId) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  return Boolean(row);
}

/**
 * The composite withMcpAuth verifier. Dispatch is by token shape - a JWT has
 * two dots, a board key is 64 hex chars - so board keys never reach the JWT
 * verifier and OAuth calls never cost a key lookup. `verifyUserToken` is
 * injected (lib/auth.ts owns it); its failures become a quiet `undefined`,
 * which withMcpAuth turns into the 401 + resource-metadata challenge OAuth
 * clients follow. The user row is checked because a deleted account's JWT
 * stays valid until exp, and a ghost user must re-auth, not FK-500.
 */
export async function verifyMcpBearer(db, request, bearerToken, { verifyUserToken } = {}) {
  if (!bearerToken) return undefined;
  if (bearerToken.split('.').length === 3) {
    if (!verifyUserToken) return undefined;
    const claims = await Promise.resolve()
      .then(() => verifyUserToken(request))
      .catch(() => null);
    if (!claims?.sub) return undefined;
    if (!(await userExists(db, claims.sub))) return undefined;
    // Disconnect: the signature is still good, but the user has since revoked
    // this client, and the token predates that. Refused here, not at exp.
    if (
      typeof claims.client_id === 'string' &&
      (await isRevoked(db, { userId: claims.sub, clientId: claims.client_id, iat: claims.iat }))
    ) {
      return undefined;
    }
    return {
      token: bearerToken,
      clientId: typeof claims.client_id === 'string' ? claims.client_id : `user:${claims.sub}`,
      scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : ['user'],
      // Seconds since epoch; withMcpAuth enforces expiry from this field.
      expiresAt: claims.exp,
      extra: { mode: 'user', userId: claims.sub, origin: origin(request) },
    };
  }
  return verifyBoardKey(db, request, bearerToken);
}

/* ---- schemas ---- */

const textField = z
  .string()
  .max(20000)
  .describe('Prose; the board uppercases, wraps, and paginates it. \\n is a line break.');
const rowsField = z
  .array(z.string().nullable())
  .max(200)
  .describe(
    'Literal rows: one string per board row, one character per tile, no wrapping or alignment. Mutually exclusive with text, align, valign, wrap, and collapseSpaces.',
  );
const layoutFields = {
  align: z.enum(['left', 'center', 'right']).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  wrap: z.enum(['word', 'char', 'none']).optional(),
  dwellMs: z.number().nonnegative().optional().describe('How long each page holds, in ms.'),
  collapseSpaces: z.boolean().optional(),
  substitutions: z
    .record(z.string(), z.string())
    .optional()
    .describe('Extra character mappings applied before the charset fold.'),
};
const scheduleField = z
  .looseObject({
    kind: z.enum(['interval', 'everyN', 'hourly', 'daily', 'weekly', 'once']),
  })
  .describe(
    'Clock (scheduled/shared) boards only; a live board refuses it with 422. Fields by kind: interval{everyMs>=5000}, everyN{minutes,offsetSec?}, hourly{minute,second?}, daily{at:"HH:MM[:SS]"}, weekly{dow,at}, once{atMs}. All take durationMs? (omit = one read-through, null = until its own next trigger).',
  );

/* ---- the tools ---- */

/**
 * Each tool: MCP config plus a `call` describing the REST request to make.
 * `call(args)` returns `{handler, path?, method?, body?, itemId?, raw?}`.
 */
const TOOLS = [
  {
    name: 'get_board_info',
    config: {
      title: 'Board info',
      description: 'Discovery: the board’s name, type, status, and URLs.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: boardIndex }),
  },
  {
    name: 'get_docs',
    config: {
      title: 'Agent guide',
      description:
        'This board’s full agent guide (markdown): character set and folding rules, grid, playback model, scheduling, and recommended workflow. Read it before composing anything non-trivial.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: agentsDoc, path: '/AGENTS.md', raw: true }),
  },
  {
    name: 'get_health',
    config: {
      title: 'Health',
      description:
        'Liveness. boardReady means a display tab is connected right now; false means messages queue but nothing shows them.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: health, path: '/health' }),
  },
  {
    name: 'get_capabilities',
    config: {
      title: 'Capabilities',
      description:
        'The board’s real character set, grid geometry, accepted option values, and limits. Check before composing rows or unusual text.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: capabilities, path: '/capabilities' }),
  },
  {
    name: 'get_status',
    config: {
      title: 'Board status',
      description:
        'What the glass shows: lines is the literal rows as the display last reported them, plus the queue summary (server truth). boardReady: true means a display reported within the last few seconds; stale: true means none has, so lines may be old and nothing is showing new messages - tell the user to open the board URL on a screen. The cheapest way to confirm a message landed.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: status, path: '/status' }),
  },
  {
    name: 'preview',
    config: {
      title: 'Preview a message',
      description:
        'Lay out text without queuing or displaying anything. Returns the exact pages the board would show plus diagnostics naming every substituted or dropped character. Use it before post_message when the text has punctuation, symbols, or non-English characters, and tell the user if something meaningful was lost.',
      inputSchema: z.object({
        text: textField.optional(),
        rows: rowsField.optional(),
        ...layoutFields,
      }),
      annotations: { readOnlyHint: true },
    },
    call: (args) => ({ handler: preview, path: '/preview', method: 'POST', body: args }),
  },
  {
    name: 'post_message',
    config: {
      title: 'Post a message',
      description:
        'Queue a message on the board. A 202 means validated and queued, not yet displayed - get_status confirms, and its boardReady says whether any screen is showing it. priority "next" plays after the current message, "now" pre-empts it - nothing is discarded either way; prefer "next", save "now" for the genuinely urgent. loop: true cycles the message until switched off. Text is folded onto the board’s limited character set; preview first when it has symbols or non-English characters.',
      inputSchema: z.object({
        text: textField.optional(),
        rows: rowsField.optional(),
        ...layoutFields,
        priority: z
          .enum(['normal', 'next', 'now'])
          .optional()
          .describe('Where it lands: back of the queue, head, or immediate pre-empt.'),
        loop: z
          .boolean()
          .optional()
          .describe('Rejoin the queue after playing; edit or remove the item to stop it.'),
        schedule: scheduleField.optional(),
      }),
    },
    call: (args) => ({ handler: postMessage, path: '/message', method: 'POST', body: args }),
  },
  {
    name: 'list_queue',
    config: {
      title: 'List the queue',
      description:
        'The server-side queue: items, what is current or scheduled-active, and the board config. Server truth even with no display connected.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: getQueue, path: '/queue' }),
  },
  {
    name: 'update_queue_item',
    config: {
      title: 'Edit a queue item',
      description:
        'Change an item’s text or rows, toggle loop, or change its schedule (clock boards).',
      inputSchema: z.object({
        itemId: z.string(),
        text: textField.optional(),
        rows: rowsField.optional(),
        loop: z.boolean().optional(),
        schedule: scheduleField.optional(),
      }),
      annotations: { idempotentHint: true },
    },
    call: ({ itemId, ...body }) => ({
      handler: patchQueueItem,
      path: `/queue/items/${encodeURIComponent(itemId)}`,
      method: 'PATCH',
      body,
      itemId,
    }),
  },
  {
    name: 'delete_queue_item',
    config: {
      title: 'Remove a queue item',
      description: 'Remove one item; removing the playing item skips it.',
      inputSchema: z.object({ itemId: z.string() }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    call: ({ itemId }) => ({
      handler: deleteQueueItem,
      path: `/queue/items/${encodeURIComponent(itemId)}`,
      method: 'DELETE',
      itemId,
    }),
  },
  {
    name: 'reorder_queue',
    config: {
      title: 'Reorder the queue',
      description: 'Move an item after another; afterId null means the front of the pending queue.',
      inputSchema: z.object({ itemId: z.string(), afterId: z.string().nullable() }),
    },
    call: (args) => ({ handler: reorderQueue, path: '/queue/reorder', method: 'POST', body: args }),
  },
  {
    name: 'flush_queue',
    config: {
      title: 'Flush pending items',
      description:
        'Drop everything pending; the currently playing message finishes (a looping item rejoins - this does not stop loops). Do not use it to make room for your own message; priority does that without discarding.',
      inputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    call: () => ({ handler: flushQueue, path: '/queue', method: 'DELETE' }),
  },
  {
    name: 'clear_board',
    config: {
      title: 'Clear the board',
      description:
        'Stop everything and blank the glass - queue included. The deliberate blank; only use when asked.',
      inputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    call: () => ({ handler: clearBoard, path: '/clear', method: 'POST' }),
  },
  {
    name: 'update_config',
    config: {
      title: 'Update board config',
      description:
        'Patch display config. Re-lays out everything queued. Do not reshape a user’s board to fit your text without saying so - fit the text to the board, or ask. Unknown keys are refused by the board, not ignored.',
      inputSchema: z.looseObject({
        cols: z.number().int().min(1).max(80).optional().describe('Grid width in tiles.'),
        rows: z.number().int().min(1).max(40).optional().describe('Grid height in tiles.'),
        align: z.enum(['left', 'center', 'right']).optional(),
        valign: z.enum(['top', 'middle', 'bottom']).optional(),
        wrap: z.enum(['word', 'char', 'none']).optional(),
        dwellMs: z
          .number()
          .min(0)
          .max(600000)
          .optional()
          .describe('Default hold per page, ms (message dwellMs overrides it).'),
        staggerMode: z
          .enum(['none', 'column', 'row', 'diagonal', 'random'])
          .optional()
          .describe('How tiles start flipping relative to each other.'),
        timezone: z.string().optional().describe('Clock boards: IANA zone, e.g. Europe/London.'),
        fallback: z
          .string()
          .max(400)
          .optional()
          .describe('Clock boards: the message standing between scheduled items.'),
      }),
      annotations: { idempotentHint: true },
    },
    call: (args) => ({ handler: patchConfig, path: '/config', method: 'PATCH', body: args }),
  },
  {
    name: 'export_queue',
    config: {
      title: 'Export the queue',
      description: 'Every queued item in a re-postable shape - payloads, loop flags, schedules.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: exportQueue, path: '/export' }),
  },
];

/**
 * Account tools: only meaningful on a user (OAuth) connection. On a board-key
 * connection they answer with a pointer at OAuth instead of running.
 * `root: true` means the path is absolute, not under /api/b/{slug}; `noSlug`
 * means the tool takes no board argument at all.
 */
const USER_TOOLS = [
  {
    name: 'list_boards',
    userOnly: true,
    noSlug: true,
    config: {
      title: 'List your boards',
      description:
        'Your account’s boards: slug, name, type, status, and URLs. The slugs are what every board tool takes. (Requires an OAuth connection.)',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: listBoards, path: '/api/boards', root: true }),
  },
  {
    name: 'create_board',
    userOnly: true,
    noSlug: true,
    config: {
      title: 'Create a board',
      description:
        'Create a new board on your account. Returns its slug, URLs, and API key. Types: live (a played queue), scheduled (a clock plays items by schedule; takes timezone), shared (scheduled, for many screens). (Requires an OAuth connection.)',
      inputSchema: z.object({
        name: z.string().optional(),
        slug: z.string().optional().describe('Chosen URL name; omit for a generated one.'),
        type: z.enum(['live', 'scheduled', 'shared']).optional(),
        timezone: z.string().optional().describe('IANA timezone, for clock types.'),
        fallback: z.string().optional().describe('Clock types: the message shown between scheduled items.'),
        queueCap: z.number().int().min(1).max(50).optional().describe('Live boards: queue depth (default 5).'),
      }),
    },
    call: (args) => ({ handler: createBoard, path: '/api/boards', method: 'POST', body: args, root: true }),
  },
  {
    name: 'get_board_key',
    userOnly: true,
    config: {
      title: 'Get a board’s API key',
      description:
        'The board’s API key, for handing to displays or headless automation. Owner only. (Requires an OAuth connection.)',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    call: () => ({ handler: getBoardKey, path: '/key' }),
  },
];

/** Exposed for tests and docs; the registration below is the live path. */
export const MCP_TOOLS = [...TOOLS, ...USER_TOOLS];

function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Turn the transport's authInfo plus the tool's `slug` argument into the
 * call's resolved auth, or a tool error. Board mode is bound to its key's
 * board; user mode must name one (except account tools).
 */
export function resolveToolAuth(authInfo, slugArg, tool = {}) {
  const extra = authInfo?.extra ?? {};
  if (extra.mode === 'board') {
    if (tool.userOnly) {
      return toolError(
        'this tool needs an account connection - connect via OAuth (no API key) to manage boards',
      );
    }
    if (slugArg !== undefined && slugArg !== extra.slug) {
      return toolError(
        `this API key is bound to board "${extra.slug}" - omit slug, or connect via OAuth to reach other boards`,
      );
    }
    return { mode: 'board', slug: extra.slug, origin: extra.origin, token: authInfo.token };
  }
  if (extra.mode === 'user') {
    if (!tool.noSlug && slugArg === undefined) {
      return toolError('pass slug to say which board - list_boards shows yours');
    }
    return { mode: 'user', slug: slugArg, origin: extra.origin, userId: extra.userId };
  }
  return toolError('this endpoint needs a bearer token: a board API key, or an OAuth access token');
}

/** Drive one REST handler as the tool's implementation. */
export async function callTool(tool, args, ctx, auth) {
  const { handler, path = '', method = 'GET', body, itemId, raw, root } = tool.call(args ?? {});
  const url = root
    ? `${auth.origin}${path}`
    : `${auth.origin}/api/b/${encodeURIComponent(auth.slug)}${path}`;
  const request = new Request(url, {
    method,
    headers: {
      // User-mode calls carry no credential; the stubbed session is the auth.
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const handlerCtx = itemId === undefined ? { ...ctx, slug: auth.slug } : { ...ctx, slug: auth.slug, itemId };
  const response = await handler(request, handlerCtx);
  if (raw) {
    return { content: [{ type: 'text', text: await response.text() }], isError: response.status >= 400 };
  }
  const payload = await response.json().catch(() => null);
  const isError = response.status >= 400;
  // Errors carry the HTTP status so callers can apply the documented status
  // table (401 ask for the key, 404 ask for the board URL, 429 queue full...).
  const shown = isError ? { status: response.status, ...payload } : payload;
  return { content: [{ type: 'text', text: JSON.stringify(shown, null, 2) }], isError };
}

/** The per-mode handler ctx: user mode acts as the token's user. */
export function authContext(base, auth) {
  return {
    ...base,
    getSession: auth.mode === 'user' ? async () => ({ user: { id: auth.userId } }) : async () => null,
  };
}

/**
 * Register every tool on an MCP server. `ctxFactory` supplies `{broker, db}`
 * per call (the route binds the real singletons; tests inject); mode, board,
 * and identity ride in from the transport's authInfo. The `slug` argument is
 * grafted onto each board tool's schema here and stripped before the tool's
 * own `call` sees the args - several tools forward args wholesale as a
 * request body, and a stray slug would corrupt it.
 */
export function registerBoardTools(server, ctxFactory) {
  for (const tool of MCP_TOOLS) {
    const config = tool.noSlug
      ? tool.config
      : {
          ...tool.config,
          inputSchema: tool.config.inputSchema.extend({
            slug: z
              .string()
              .optional()
              .describe(
                'Which board (OAuth connections; list_boards shows yours). Omit on API-key connections.',
              ),
          }),
        };
    server.registerTool(tool.name, config, async (args, mcpCtx) => {
      // Strip the grafted board-selector before the tool sees its args - but
      // only where it was grafted: a noSlug tool's own `slug` field (e.g.
      // create_board's chosen URL name) is the tool's to keep.
      const all = args ?? {};
      const { slug: grafted, ...stripped } = all;
      const slugArg = tool.noSlug ? undefined : grafted;
      const rest = tool.noSlug ? all : stripped;
      const auth = resolveToolAuth(mcpCtx?.http?.authInfo, slugArg, tool);
      if (auth.isError) return auth;
      return callTool(tool, rest, authContext(await ctxFactory(), auth), auth);
    });
  }
}
