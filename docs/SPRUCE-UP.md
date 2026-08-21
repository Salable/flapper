# Release spruce-up — working ledger

A living list kept while walking Flapper as a first-time user and as an agent,
after the MCP interface shipped (2026-08-21). One doc, three lists, so the
recent past has somewhere to live. Delete when the release is cut.

Method: sign up fresh, follow our own docs literally, connect an agent, and
note every place a user is likely to see or do the wrong thing. Fix in small
commits straight to main; move items down the lists as they move.

## To fix

- [ ] **Nowhere in the product says "connect Claude / ChatGPT".** Homepage copy,
      README, GETTING-STARTED §5, the dashboard, and Settings → General's
      "For agents" block all predate MCP and only mention the REST API.
      The MCP URL is account-level → the dashboard needs a "Connect an AI"
      card (OAuth mode); Settings → General needs the key-mode recipe
      (`claude mcp add … --header`) with a copy button.
- [ ] No "disconnect this app" UI for OAuth consents (revoking = deleting
      the `oauth_consent` row). Account-level; dashboard or a /account page.
- [ ] Consent page shows the raw client_id URL when the client has no
      registered name (CIMD clients mostly do; DCR ones may not).
- [ ] GitHub Dependabot: 1 moderate alert on main — check what/if relevant.
- [ ] README feature bullets: add MCP.
- [ ] Docs registry (/docs): Getting Started should cover "connect an agent";
      consider a short dedicated page.

## Fixing

## Fixed

- [x] Dashboard: "Connect Claude or ChatGPT" card with the MCP URL + copy;
      Docs link in the signed-in header; empty state points at Claude.
      Settings → General: key-mode `claude mcp add` recipe with copy, and
      the "For agents" blurb now leads with MCP.

- [x] Wordmark threw `charset.filter is not a function` on every ambient
      beat (Set vs array) on every page with a wordmark. `94d3af6`.

