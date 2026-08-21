/**
 * RFC 9728 protected-resource metadata for the MCP endpoint. The resource is
 * {base}/api/mcp, so clients request
 * /.well-known/oauth-protected-resource/api/mcp first and the bare root form
 * second; the optional catch-all serves both. This URL is what the MCP 401
 * challenge advertises - the OAuth flow dead-ends without it.
 */

import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler';
import { mcpResource, oauthIssuer } from '@/lib/auth';

const handler = protectedResourceHandler({
  authServerUrls: [oauthIssuer()],
  resourceUrl: mcpResource(),
});

export { handler as GET };
export const OPTIONS = metadataCorsOptionsRequestHandler();
