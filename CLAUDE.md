# CLAUDE.md

The guide for working on this code is **[AGENTS.md](AGENTS.md)** — components,
how they fit, how the rendering works, and how to make it your own. Read that
first; this file only adds what is specific to running the repo.

## Commands

```bash
npm start                          # run the app (assets are committed)
npm test                           # 167 tests, ~0.2s, no Electron
node --test tests/layout.test.mjs  # a single file
npm run pack                       # .app bundle + zip
python3 tools/build_assets.py      # only when the tile art changes
```

## Two documents named for agents

They serve different readers, and it is worth not confusing them:

- **`AGENTS.md`** (this file's sibling) — for working *on* the code.
- **`docs/BOARD-API.md`** — for *driving* a running board over REST. Served live
  at `GET /AGENTS.md`, with its example URLs rewritten to whatever address was
  asked. Change the contract and you are changing what every agent pointed at a
  board is told, so keep it accurate.

## Checking your work

The app is a wall display, so "it looks right" is a real acceptance criterion and
the tests cannot give it to you. `npm test` is necessary and not sufficient.

To verify something end to end, run the app and drive it over HTTP:

```bash
npm start &
curl -s http://127.0.0.1:4747/api/status
curl -X POST http://127.0.0.1:4747/api/message \
  -H 'content-type: application/json' -d '{"text":"HELLO"}'
```

`GET /api/status` returns `lines` — the literal rows on the glass — which is the
cheapest way to assert what the board is actually showing without a screenshot.

## Things that have caught people out

- `flipboard.js` has **no automated coverage** (it needs a canvas). Anything with
  a decision in it belongs in `shared/` or `panel.mjs` instead.
- `.row { display: flex }` beats the browser's own `[hidden]` rule. There is a
  `[hidden] { display: none !important }` at the top of `styles.css` holding that
  together — a conditionally hidden row silently stays visible without it.
- A message's row budget is its **band**, not the board. Read `grid.mainRows`.
- `settings` in `app.js` is a one-level spread over `localStorage`, so a stored
  nested value replaces its default wholesale with no per-key merge. Keep new
  settings flat, or bump `SETTINGS_KEY`.
