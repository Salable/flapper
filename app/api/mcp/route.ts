/**
 * The deployment's one MCP endpoint (Streamable HTTP, stateless). The tools
 * and the bearer verifier live in lib/api/mcp.mjs; this file only binds them
 * to mcp-handler and the real singletons - the same division of labour as
 * every other route.
 *
 * Two bearer modes, told apart by shape: a board's API key (the key names
 * the board), or an OAuth access token this deployment issued (the token
 * names the user; lib/auth.ts verifies it against our JWKS). The 401
 * challenge points OAuth-capable clients at the protected-resource metadata;
 * key clients just see the 401.
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { getBroker } from '@/lib/broker/index.mjs';
import { getDb } from '@/lib/db/client.mjs';
import { verifyMcpAccessToken } from '@/lib/auth';
import {
  registerBoardTools,
  verifyMcpBearer,
  serverInfo,
  serverInstructions,
} from '@/lib/api/mcp.mjs';

export const maxDuration = 300;

const handler = createMcpHandler(
  (server) => {
    registerBoardTools(server, async () => ({ broker: getBroker(), db: await getDb() }));
  },
  { serverInfo, instructions: serverInstructions },
);

const authed = withMcpAuth(
  handler,
  async (request, bearerToken) =>
    verifyMcpBearer(await getDb(), request, bearerToken, {
      verifyUserToken: verifyMcpAccessToken,
    }),
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp' },
);

export { authed as GET, authed as POST, authed as DELETE };
