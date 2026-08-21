# Release spruce-up — working ledger

A living list kept while walking Flapper as a first-time user and as an agent,
after the MCP interface shipped (2026-08-21). One doc, three lists, so the
recent past has somewhere to live. Delete when the release is cut.

Method: sign up fresh, follow our own docs literally, connect an agent, and
note every place a user is likely to see or do the wrong thing. Fix in small
commits straight to main; move items down the lists as they move.

## To fix

- [ ] Dependabot (medium, esbuild@0.18 under drizzle-kit's deprecated
      @esbuild-kit loader): a dev-server CORS issue in a tool we never serve
      from. Not exploitable here; clears when drizzle-kit drops the loader.
      Not forcing an override that could break migrations. **Noted, won't fix.**

## Fixing

## Fixed

- [x] Homepage, README (intro, features, deploy table, "Using a board"),
      Getting Started §5, /docs blurb: all lead with connecting Claude or
      ChatGPT. `6372c55`
- [x] MCP tool schemas as the model sees them: update_config declares its
      fields; get_status explains stale/lines; post_message says preview
      first. `6372c55`
- [x] Consent screen read `name` where OAuth says `client_name` → showed
      the raw id for every client. Now names the app and its URI.
- [x] **Disconnect an app**: dashboard lists connected OAuth clients with a
      Disconnect that deletes the consent *and* revokes the refresh/access
      tokens (Better Auth's own delete-consent leaves a 30-day refresh token
      alive). `lib/api/connections.mjs`, GET/DELETE /api/account/connections.

- [x] Dashboard: "Connect Claude or ChatGPT" card with the MCP URL + copy;
      Docs link in the signed-in header; empty state points at Claude.
      Settings → General: key-mode `claude mcp add` recipe with copy, and
      the "For agents" blurb now leads with MCP.

- [x] Wordmark threw `charset.filter is not a function` on every ambient
      beat (Set vs array) on every page with a wordmark. `94d3af6`.

