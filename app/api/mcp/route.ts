/**
 * The deployment's one MCP endpoint (Streamable HTTP, stateless). The tools
 * and the key verifier live in lib/api/mcp.mjs; this file only binds them to
 * mcp-handler and the real singletons - the same division of labour as every
 * other route.
 *
 * Auth is a board's API key as the bearer token - the key names the board,
 * so one URL serves every board. MCP sessions have no cookie, so getSession
 * is a constant null rather than Better Auth.
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { getBroker } from '@/lib/broker/index.mjs';
import { getDb } from '@/lib/db/client.mjs';
import {
  registerBoardTools,
  verifyBoardKey,
  serverInfo,
  serverInstructions,
} from '@/lib/api/mcp.mjs';

export const maxDuration = 300;

const handler = createMcpHandler(
  (server) => {
    registerBoardTools(server, async () => ({
      broker: getBroker(),
      db: await getDb(),
      getSession: async () => null,
    }));
  },
  { serverInfo, instructions: serverInstructions },
);

const authed = withMcpAuth(
  handler,
  async (request, bearerToken) => verifyBoardKey(await getDb(), request, bearerToken),
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
