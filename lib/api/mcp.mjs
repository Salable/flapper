/**
 * The MCP face of the service: tool definitions and the bearer-key verifier
 * for the single global endpoint, POST /api/mcp.
 *
 * Every tool drives the corresponding REST handler with a constructed
 * `Request` - the same trick tests/api.test.mjs uses - so validation, access
 * gates, and behaviour cannot drift from the HTTP surface. This module stays
 * Next-free (the route file owns `mcp-handler`); it receives the MCP server
 * instance and a ctx factory, which is what keeps it runnable under
 * `node --test`.
 *
 * Auth is a board's existing API key, presented as the MCP bearer token: one
 * endpoint for the deployment, and the key names the board (keys are 32
 * random bytes; holding one *is* the board identity). `verifyBoardKey` gates
 * the transport once; each tool then re-presents the key to its handler,
 * whose own gate runs identically. Owner-session-only operations (rename,
 * delete, key rotation) are deliberately not tools.
 */

import { z } from 'zod';
import pkg from '../../package.json' with { type: 'json' };
import * as boards from '../db/boards.mjs';
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
} from './handlers.mjs';

export const serverInfo = { name: 'flapper', version: pkg.version };

/**
 * What every connecting client is told up front - the part of the board
 * contract that is not obvious from tool schemas alone.
 */
export const serverInstructions = `This server drives one Flapper split-flap
display board - a grid of mechanical flip tiles on a wall screen. Which
board is decided by the API key you connected with. Board
behaviour to honour: the character set is limited (A-Z, 0-9, and a little
punctuation; lowercase and accents are folded, some symbols are dropped), so
run preview before posting anything with unusual characters and report
meaningful losses. Posting returns 202 = validated and queued, not displayed;
get_status's boardReady/stale say whether a display is connected, and its
lines field is the literal glass. Do not clear the board to make room
(priority "next" jumps the queue without discarding), and do not reshape the
grid without being asked. The board is public wall glass: never send secrets
or personal data. get_docs returns this board's full guide.`;

/**
 * withMcpAuth verifier: the bearer token must be some board's API key; the
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
    extra: { slug: board.slug, origin: origin(request) },
  };
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
        'What the glass shows right now: lines is the literal rows on the display, plus the queue summary and stale/boardReady. The cheapest way to confirm a message landed.',
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
        'Queue a message on the board. 202 = validated and queued, not yet displayed (get_status confirms). priority "next" plays after the current message, "now" pre-empts it - nothing is discarded either way; prefer "next". loop: true cycles the message until switched off.',
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
        'Patch display config: cols (1-80), rows (1-40), align, valign, wrap, dwellMs; clock boards also take timezone (IANA) and fallback. Re-lays out everything queued. Do not reshape a user’s board to fit your text without saying so.',
      inputSchema: z.looseObject({}),
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

/** Exposed for tests and docs; the registration below is the live path. */
export const MCP_TOOLS = TOOLS;

/** Drive one REST handler as the tool's implementation. */
export async function callTool(tool, args, ctx, auth) {
  const { handler, path = '', method = 'GET', body, itemId, raw } = tool.call(args ?? {});
  const request = new Request(`${auth.origin}/api/b/${encodeURIComponent(auth.slug)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${auth.token}`,
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

/**
 * Register every board tool on an MCP server. `ctxFactory` supplies
 * `{broker, db, getSession}` per call (the route binds the real singletons;
 * tests inject); the slug and key ride in from the transport's authInfo.
 */
export function registerBoardTools(server, ctxFactory) {
  for (const tool of TOOLS) {
    server.registerTool(tool.name, tool.config, async (args, mcpCtx) => {
      const authInfo = mcpCtx?.http?.authInfo;
      if (!authInfo?.extra?.slug) {
        return {
          content: [{ type: 'text', text: 'this endpoint needs the board’s API key as the bearer token' }],
          isError: true,
        };
      }
      const auth = { token: authInfo.token, slug: authInfo.extra.slug, origin: authInfo.extra.origin };
      return callTool(tool, args, await ctxFactory(), auth);
    });
  }
}
