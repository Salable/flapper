# RFC 0003 — Engines, templates, and the six open questions

*Status: PROPOSED 2026-08-21 · Author: Claude · Scope: SPEC "Next iteration"
§5 (catalogue), §9 (open questions 1–6). The groundwork in §5 that needed no
decision — outcome copy, live previews, a marked default, tier enforcement
on the shared create path — has shipped; this records what was decided in
passing and lays out options where the spec asked for them.*

## What shipped without needing a decision

| Ask | Where |
| --- | --- |
| Cards sell outcomes, not chips naming the machinery | `capabilities` on each definition is now the outcome list; the card renders it as a short list |
| Live previews as the centrepiece | `sample` on each definition; the card renders the real engine (`Flapper`, 15px tiles) |
| A marked default | `recommended: true` on the live queue → "Start here"; copy says a live board cannot be given a schedule later |
| Entitlement enforced server-side and on MCP | `tier` on a definition; `entitled()` in the contract; `createBoard` (shared by REST and `create_board`) refuses with a `402` naming both tiers. No shipped type is locked |
| "Types add no server routes" as a guarantee | `docs/BOARD-TYPES.md`, stated as the property that makes hosting a third-party type safe |

## Q2 — Engine vs template: how far to take the split

**Recommendation: templates are data — `{ typeId, config, seedItems,
listing }` — with no presentation hooks in v1.**

Three options, from least to most machinery:

**A. Template = preset (recommended).** A template is a JSON document:

```js
{
  id: 'departures',            // the listing's slug
  engine: 'scheduled',         // a registered type id
  config: { timezone: 'UTC', fallback: 'NO DEPARTURES' },
  seedItems: [{ text: 'LAST TRAIN 23 45', schedule: { … } }],
  listing: { name: 'Departures', tagline: '…', capabilities: ['…'],
             sample: 'LAST TRAIN 2345', tier: undefined },
}
```

Creating from a template is exactly `createBoard(engine, config)` followed
by `ingest` for each seed item, on the existing handlers. The board row
records `templateId` for attribution and nothing else; after creation the
board is an ordinary board of its engine. Validation is the engine's own
`createParams` + `validateConfig` + `ingest`, so a template cannot express
anything its engine would refuse. A third party publishes one by submitting
a file; review is reading it.

*Cost:* a `templates/` directory (or table, later), a `templateId` column,
one branch in the create modal (templates and engines in one grid, templates
first), and `create_board` taking `template` as an alternative to `type`.
*Limit:* a template cannot change how anything looks — a "Countdown" that
wants a big-digit layout is an engine request, not a template.

**B. Template = preset + presentation hints.** A adds a constrained
`presentation` block the display honours: a `layout` preset name, a tile
size, maybe a standing header row. Still data, still no code, but now the
display player has a vocabulary to maintain and every hint is a compatibility
promise to third parties. Worth doing only once two real templates want the
same hint.

**C. Template = mini-engine** (hooks for `ingest`/`itemAt` in a sandbox).
Reintroduces exactly the trust problem the no-routes guarantee avoids.
Not recommended at any point a third party is involved.

**Minimum for a third party to publish (under A):** a JSON file that
validates against its engine, a listing block, and a sample line. That is
the whole contract; the contract harness can run a template through
`createBoard` + `ingest` on a scratch db as its test.

## Q4 — Catalogue and entitlement: where does tier live?

**Recommendation: the tier *check* lives in Flapper (it already does); the
tier *source of truth* lives in Salable, cached on `user.tier`.**

- `create_board`, REST and MCP, calls `entitled(type, accountTier)`; the
  ladder is `standard < plus < pro` in `lib/board-types/contract.mjs`. This
  is the only place a paywall is real, and it is in place.
- `user.tier` is the dormant column from 4.0 (`standard` by default). A
  Salable webhook (or a sync on sign-in) writes it; nothing else reads
  Salable at request time, so an outage degrades to "whatever tier we last
  knew", never to a 500 on create.
- What the MCP path checks is therefore one indexed read of the user row,
  already on the create path. A locked type's `402` says the tier needed
  and the tier held, and what to do — the `reject(msg, code)` idiom the
  spec pointed at.
- Keeping/continuing to run an *existing* board whose type is later locked
  is a different question (RFC 0002's dormancy answer — `status =
  'deactivated'` + export — still stands and is not changed here).

## Q3 — Immediate revocation: what it cost

**Answered by shipping it.** The pinned `@better-auth/oauth-provider` has no
supported way to invalidate an issued JWT access token, because it never
stores one: `createJwtAccessToken` signs and returns, and only opaque
tokens get an `oauth_access_token` row. So "revoke access tokens" in the
old disconnect revoked nothing a Claude connection used.

The fix is not a blacklist. One row per (user, client) — `oauth_client_
revocation.not_before` — upserted on disconnect; the MCP verifier rejects
any token whose `iat` predates it. Cost: one primary-key read per MCP
request (the request already reads the user row), zero growth, no cleanup
on reconnect. Tests: `tests/connections.test.mjs`.

## Q1 — The background-tab freeze: which answer?

**Recommendation: detect it loudly now (shipped), recommend the kiosk shell
for real walls, and do not attempt Wake Lock / OffscreenCanvas.**

- *Detect loudly* — shipped. The display stamps `visibility` and frame age;
  `/status`, `/health`, and the dashboard card say `frozen`. An agent and a
  person both learn the wall is not moving within a heartbeat.
- *Electron kiosk* — the right answer for a wall a customer owns. A kiosk
  window is never "hidden", so rAF never stops; the shell exists
  (`desktop/`) and is now what Getting Started recommends.
- *Wake Lock* only prevents the screen sleeping; it does not stop a browser
  throttling a hidden tab. *OffscreenCanvas in a Worker* keeps the canvas
  drawing while hidden, but the compositor still does not present a hidden
  tab, so the wall shows the same frozen frame — and the flip's timing model
  (`lib/board/timing.mjs`) would have to move into the worker. High cost,
  no visible gain.
- What a customer's wall actually runs is the open input: if it is a TV
  browser or a signage player with no Electron, the honest guidance is "one
  full-screen tab, nothing on top", which the doc now says.

## Q5 — Branch divergence

Resolved before work started: `main`, the `mcp-interface-integration`
worktree, and this branch were all at `da895a8`; the connect card was in
`main`. The spec's note was stale. This branch is the authoritative line.

## Q6 — Sidebar side, and how many columns

**Decided: one left column — identity, then the vertical menu, then the
standing links; panel to the right.** The second option (nav left, details
right, panel centre) keeps details visible on every tab but costs a third
column on a screen whose panel already wants 680px; the single column keeps
the details visible on every tab *and* stays a two-column page. At phone
width the column dissolves into the page in reading order: identity, menu,
panel, links last. The paused chip stays in the AppBar as well, since a
paused board is playing nothing and that should never be scrolled away.
