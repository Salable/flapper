export const dynamic = 'force-dynamic';

/**
 * The generic guide at the site root. An agent pointed here has a URL but no
 * board; the per-board document at /api/b/{slug}/AGENTS.md is the real one.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) url.protocol = `${proto}:`;
  const base = url.origin;
  const body = `# Flapper

This is a Flapper split-flap board service, but you have reached the site root
rather than a board. Every board has its own URL and its own API.

- A board's display page looks like: \`${base}/b/{slug}\`
- Its API base is: \`${base}/api/b/{slug}\`
- Its full agent guide is served at: \`${base}/api/b/{slug}/AGENTS.md\`

If a user asked you to drive a board, ask them for the board URL (or its slug)
and its API key — the key lives on the board's settings page, which only the
board's owner can open. Do not guess slugs or keys.

If your client speaks MCP, prefer the MCP endpoint at \`${base}/api/mcp\`:
sign in via OAuth (add it as a connector and authorize) to act as the user's
account — list their boards, create boards, and drive any of them — or
present a board's API key as the bearer token to drive that one board.

Boards are created by signed-in users from ${base}/dashboard, or over MCP
with \`create_board\` on an OAuth connection.
`;
  return new Response(body, {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
  });
}
