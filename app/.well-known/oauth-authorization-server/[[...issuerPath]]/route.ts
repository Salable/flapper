/**
 * RFC 8414 authorization-server metadata. Our issuer carries a path
 * (/api/auth), so per the discovery spec clients request
 * /.well-known/oauth-authorization-server/api/auth - a root-level URL the
 * auth catch-all route never sees. The optional catch-all also serves the
 * bare root form for clients that fall back to it. OPTIONS carries CORS for
 * browser-based clients (MCP Inspector).
 */

import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { metadataCorsOptionsRequestHandler } from 'mcp-handler';
import { getAuth } from '@/lib/auth';

export async function GET(request: Request) {
  return oauthProviderAuthServerMetadata(await getAuth(), {
    headers: { 'access-control-allow-origin': '*' },
  })(request);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
