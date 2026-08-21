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

- [x] Agent guide (live template + repo copy) contradicted itself on bands
      ("name the band you mean on clear" vs "region is a 422") and still
      spoke of `repeat` with "no way to switch it off". Now: don't send
      region; `loop` is switched off by editing the item. Repo doc no longer
      claims there is no API way to create a board.

- [x] Login/signup reached from an app's OAuth redirect looked like a random
      login. Now a banner names the app ("Claude wants to connect to your
      Flapper boards. Sign in to continue."), via the provider's pre-login
      lookup (`allowPublicClientPrelogin`). The login<->signup cross-links
      dropped the OAuth query, stranding brand-new users; they carry it now.
      Verified: redirect → Create one → signup → consent, end to end.

- [x] Invisible button labels: the 404 page's "Your dashboard" and the
      private-board "Sign in" rendered bone-on-bone (a later
      `main.landing a` rule tied with `a.button.primary`). Moved those pages
      to the design-system LinkButton/Button, which the rule exempts.

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

