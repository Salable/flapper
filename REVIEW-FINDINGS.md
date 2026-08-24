# Review: `claude/design-pass` (59 files, +6896/−384)

Five lenses, every finding adversarially checked. Ranked by what actually hurts. Line numbers verified against HEAD.

---

## 1. A pack can point art and fonts at a third-party host, and every viewer of a public board fetches it
`lib/board/theme-pack.mjs:278` (art), `:285` (fonts)

The art check is `/^(data:image\/(png|webp);base64,|\/)/` and the font check is `/^\//`; a **protocol-relative** URL (`//attacker.example/beacon.png`) satisfies both, so the comment two lines above — "Never a remote URL … a board must not be able to make every viewer fetch a third party" — is not enforced.

Reproduced end to end against the running dev server: `POST /api/designs` with that art + font → 201 stored verbatim; `POST /api/boards {designId}` → public board; `curl` of `/b/{slug}` **with no cookies** returns HTML containing both `attacker.example` URLs. `checkThemePackLimits` skips the value (its guard at `board-theme.mjs:145` only inspects `data:` values), `resolveBoardTheme` returns it with `warnings: []`, `assets.ts:65` does `fetch(src)` and `:49` `new FontFace(family, url(src))`. There is no CSP anywhere (`next.config.mjs` sets only Cache-Control for `/fonts`; no `middleware.ts`, no `vercel.json`). Result: a per-wall tracking beacon disclosing every viewer's IP and User-Agent. The FontFace load fails CORS, but the request still leaves the browser.

This is a pre-existing validator hole, but `/api/designs` is a **new, explicitly agent-facing door** onto it (`/designs` says "have an agent post a pack to /api/designs"), so an injected agent can plant it without a human ever opening the editor. `PATCH /api/b/{slug}/config` reaches the same code.

**Smallest fix:** in both regexes, reject a value whose second character is `/` — e.g. require `/^\/(?!\/)/` for the root-relative arm. One line each, in `theme-pack.mjs`, not in the design handlers.

## 2. Two concurrent read-modify-write PATCHes of the same config row
`components/DisplayConfig.tsx:131` (`setScreen` → `patch('screen')` then `fitRows` → `patch('rows')`), `:281` (bare `<input type=range>`, no debounce), server side `lib/db/boards.mjs:104`

`patch()` (`:151`) dispatches `fetch` before its first `await`, so one click on a screen preset issues two in-flight PATCHes against one JSON column that the server merges with no transaction and no version check (`handlers.mjs:805-847` adds none).

Two distinct failures, both demonstrated:
- **UI desync, reproduces locally.** Real HTTP run: the screen request's response body carried the *pre-update* snapshot `{rows:8, screen:{w:9,h:16}}` while the rows request returned `{rows:36}`. `patch()` mirrors the whole server config back via `setConfig(prev => ({...prev, ...body.config}))`, so whichever response lands last dictates the panel — the settings UI shows rows 8 while the server holds 36.
- **Actual lost update, hosted only.** On the default local PGlite I could not lose a write in 20+ concurrent attempts (queries are sub-millisecond). With every query delayed 15ms to stand in for the wire — `lib/db/client.mjs:13-22` says production is Neon over a websocket Pool — the screen change is silently dropped: stored `{rows:36, screen:{w:16,h:9}}`. Harness: `…/scratchpad/race5.test.mjs`.

**Smallest fix:** client side, make `setScreen` send one PATCH (`{screen, rows}`) instead of two, and debounce the cols slider. That kills both halves without touching the DB path; the unguarded merge in `boards.mjs` is worth a follow-up but is not what fires here.

## 3. A drifting wash never starts on a board that is holding a message
`lib/board/flipboard.js:591` (the `immediate` branch)

The `immediate` branch honours `needsFrames()` only as a reason *not* to stop — `if (!this.needsFrames()) this.stop()` — never as a reason to start. The non-immediate branch (`:592`) does `else if (this.needsFrames()) this.start()`. So `setRegionPage(..., {immediate:true})` on a board with a runner or drift leaves the loop unarmed.

Harness against the real module with the shipped `THEMES.marquee` tint: after construct `raf=null`, `isDrifting()=true`, `needsFrames()=true`; after the immediate call, `raf` is **still null**, `requestAnimationFrame` called **0 times**; the non-immediate call arms it. No other path arms it — `grep '\.start()'` across `components lib/board hooks app` finds only `BoardApp.tsx:332 player.start()` (the Player) and `flipboard.js:594`; `setSkin` (`:174-186`) only calls `draw()`; ambient is gated on `config.ambientMs`, default 0.

Reach: `player.mjs:279 showHeld` (hit on every fresh reload via `resync`'s holding branch, `:170-174`) and `track.mjs:211, :220, :222` (resume, re-hold, blank). Precisely: the runner freezes until some *other* event repaints — a resize or DPR change jumps it forward. On a wall that is effectively never. `flipboard.js` has no automated coverage by project rule, so nothing catches it.

**Smallest fix:** in the immediate branch, `if (this.needsFrames()) this.start(); else this.stop();` before the `draw()`.

## 4. `BoardApp` never stops the board, so the drifting loop runs for the life of the tab
`components/BoardApp.tsx:369-385` (effect cleanup)

The cleanup clears `cancelled`, progress, ambient, the EventSource, the observer, both listeners, the player and the sound — but never `board.stop()`, and `board` is a local `const` inside the async IIFE with no ref, so it *cannot* reach it. `tick()` re-arms unconditionally while `needsFrames()` is true (`flipboard.js:521` → `:443` → `isDrifting()` `:340`), so the loop never parks: 3000 synthetic rAF ticks end with `raf=3001` and a callback still pending. `(window as any).flipboard = board` (`:297`) keeps it reachable, so it is not even collectable.

The real cost is not memory — skins are cached module-globally by rev (`assets.ts:141-143`) and are shared property either way. It is a full-board draw at 60fps forever, and on the `initialRev` path **two live loops painting the same canvas element**, where the stale board repaints the old page over the new one. The code's own comment at `:176-180` already recognises that hazard — for the ambient timer only. `ThemePreview.tsx:145-170` gets this right (IO start/stop plus an unmount `boardRef.current?.stop?.()`); `BoardApp` has neither.

**Smallest fix:** hold the board in a ref alongside `playerRef`/`soundRef` and call `boardRef.current?.stop()` in the cleanup.

## 5. `tint: {corners: null}` / `{gradient: null}` throws out of `validatePack` — 500s and a render crash
`lib/board/theme-pack.mjs:210` and `:225` (guards), `:214` and `:230` (`Object.keys(null)`)

`typeof null === 'object'` passes the guard; `Object.keys(null)` then throws `TypeError`. The runner branch at `:186` already has `|| runner === null` — the fix is the shape used one branch above.

Reproduced at every layer: `PATCH /api/b/{slug}/config -d '{"themePack":{"tint":{"corners":null}}}'` → **500 `{"error":"internal error"}`** (stack: `theme-pack.mjs:214 → board-theme.mjs:199 → validators.mjs:167 → handlers.mjs:810`); `POST /api/designs` hits the same throw via `designPack` (`handlers.mjs:1176`, no guard); `resolveBoardTheme` documents "Never throws" at `board-theme.mjs:168` and calls `validatePack` uncaught at `:180`, so that contract is broken. Client side, "Apply JSON" (`ThemeSettings.tsx:517-527`) catches only `JSON.parse` errors, and the next render evaluates `useMemo(draftToPatch)` → `theme-editor.mjs:128 validatePack` — the throw escapes render and the unsaved draft is lost. `DesignEditor.tsx:60` has the same shape. Every adjacent bad value is a clean 422; this is the one input in the branch that crashes.

No write path can persist such a row (every writer validates first), so the dashboard's uncaught `resolveBoardTheme` at `app/dashboard/page.tsx:50` is a latent consequence, not a current outage.

**Smallest fix:** add `|| tint.corners === null` / `|| tint.gradient === null` to the two guards.

## 6. `ThemePreview` never parks a board that was below the fold when it was built
`components/flapper/ThemePreview.tsx:151`

The IntersectionObserver is attached at mount (`:157`) but the board is built asynchronously — a 120ms `setTimeout` wrapping `loadProcedural` (fonts + `document.fonts.ready`). IO delivers its initial observation within a frame or two, well inside that window, and the callback returns at `:151` because `boardRef.current` is still null. No further entry arrives until the element actually crosses the threshold, so a card never scrolled to is never stopped.

Concretely: `/designs` at the 60-design limit — "In the box" (`DesignGallery.tsx:312`, contains Marquee) sits below "Yours" (`:193`), so the Marquee card is built off-screen and draws at 60fps for the tab's life. Non-drifting cards park themselves after their opening flip (harness: 95 frames, then quiet), so the permanent damage is limited to drifting designs; the transient cost is 60 simultaneous rAF loops at page load, exactly what the effect's comment says it exists to prevent.

**Smallest fix:** keep the last `isIntersecting` in a ref and consult it immediately after `new Flipboard(...)`.

## 7. The `loop` timer permanently un-parks a drifting board the observer had stopped
`components/flapper/ThemePreview.tsx:189-193` (loop interval, no visibility gate) → `flipboard.js:593`

Demonstrated: build, `setText`, `board.stop()` (what the IO callback does on leaving view), `setText` again (what the loop tick does via `setReplays` → the text effect at `:173-186`) → `raf` goes from null back to armed, because `setRegionPage` ends with `else if (this.needsFrames()) this.start()`. Over 3 simulated seconds after the wake a plain board draws 95 frames and re-parks; a Marquee-tinted board draws all 180 and is **still armed**. Consumers: `DashboardClient.tsx:157 loop={4200}` whenever a board has more than one queued line, and `NewBoardClient.tsx:231`.

**Smallest fix:** gate the loop interval on the same intersection ref as finding 6 (skip the tick while parked).

## 8. Designs are exempt from the art count and size limits boards enforce
`lib/api/handlers.mjs:1186` (`designPack` runs only `validatePack`)

`checkThemePackLimits` (maxArts 8, maxArtBytes 16 KB) is called only from `board-theme.mjs:178`, `:197` and `handlers.mjs:340` — never from `createDesignHandler` (`:1205`) or `updateDesignHandler` (`:1240`). Confirmed by POSTing a genuine zlib-bomb PNG (10000×10000 greyscale, 97 KB file, 130 KB body) to `/api/designs` on the dev server: **201 Created**, art stored intact.

`assets.ts:87` does `Object.entries(pack.art || {})` and decodes **every** entry whether a state references it or not, and `DesignGallery.tsx:168` renders a `ThemePreview` per design. Ceiling: the 256 KB body/pack limit and deflate's ~1030:1 caps this at roughly 14000×14000, ~780 MB decoded, one bomb per pack. I could not observe an actual tab death (headless Chrome would not settle the harness even with a 1×1 PNG), so the crash rests on arithmetic. The board path is genuinely safe — `sparsify` drops unreferenced art and a referenced bomb trips maxArtBytes with a 413 — so this is confined to the owner's own `/designs` pages. Low severity for that reason, but the pack can be planted by an agent, so the person who gets the crash need not be the one who chose it.

**Smallest fix:** call `checkThemePackLimits` inside `designPack`.

## 9. `GET /api/designs` returns every full pack, and it is fetched on every Display tab mount
`lib/api/handlers.mjs:1197`, `lib/db/designs.mjs:35-41`, `components/ThemeSettings.tsx:127-139`

`listDesigns` is a `select *` shaped to include the whole `pack`; the only consumers are `<option>` names (`ThemeSettings.tsx:262`) and `chosen.pack` (`:249`). Measured: an account filled to `MAX_DESIGNS = 60` at ~245 KB each returns **14,473,959 bytes in 60 ms** for a few-hundred-byte request, repeatable, with no rate limiting anywhere (`grep` across `lib/` and `app/`; no `middleware.ts`, no `vercel.json`). `ThemeSettings` mounts unconditionally on the board settings design panel (`SettingsClient.tsx:454`) and in `DesignEditor` (`:119`), so every visit to any board's Display tab pulls all of it; `DesignGallery` does the same on `/designs`.

Two caveats worth carrying: pretty-printing is a red herring (pretty 14,473,959 vs compact 14,434,072 — 0.3%, because each pack is one long art string), and the worst case needs art-heavy designs — shipped presets are ~800-990 bytes, so 60 forks of presets is ~60 KB.

**Smallest fix:** have `listDesigns` select `id, name, basedOn, updatedAt` and leave `pack` to `GET /api/designs/{id}`.

## 10. `flightStrength: null` is accepted as 0 but means 1 to every reader
`lib/board/theme-pack.mjs:266`

`Number(null) === 0`, which sits inside the 0..1 range check. `PATCH` with `{"flight":["#f00","#0f0"],"flightStrength":null}` → **200**; the stored pack has no `flightStrength`, and `GET /theme` returns `flightStrength: 1`. Even if it were stored, every consumer coalesces it away (`procedural.mjs:120` `?? 1`; `flipboard.js:355-357` `??`), so the value can never be honoured. `validators.mjs:174-176` already refuses `footerRows: null` with a comment naming this exact trap; the new pack numerics did not get the same treatment, which puts this against the AGENTS.md "reject, don't ignore" rule.

**Smallest fix:** refuse `null` before `Number()`, the way `footerRows` does.

## 11. A tint carrying two kinds is accepted, and the losing kind is never validated
`lib/board/theme-pack.mjs:210` (the `else if` chain)

`theme-pack.d.mts:83-86` says "exactly one of gradient, corners or runner … a spec carrying two is a bug, not a blend", but a valid `runner` short-circuits past `corners` and `gradient`. `{"tint":{"runner":{...valid},"gradient":{"from":"nope","to":42}}}` is accepted and the garbage gradient is stored verbatim. `GET /theme` then hands an agent a pack whose `gradient.to` is the number `42`, and `docs/BOARD-API.md` tells that agent "sending the whole pack back with one change is the same as sending the change" — so an agent that drops `runner` to switch to the gradient it can see gets a 422 naming two fields it never wrote.

**Smallest fix:** error if more than one of the three keys is present, before dispatching on which.

---

## Tidiness (real, cheap, none of it fires at runtime)

- **`components/DesignGallery.tsx:353`** — `strip()`'s comment says "the parts that are the same for every design" but it drops `states` and `art`, the two most per-design keys there are (`theme-editor.mjs:62-94` writes every glyph override and uploaded image into exactly those). A user who colours `!` red opens "The pack", sees no trace of it, follows the page's own "have an agent post a pack to /api/designs", and gets a design missing the overrides and the art with no error. Fix: keep `states` and `art`.
- **`lib/api/handlers.mjs:1182`** — `designPack`'s 422 says "send `{ from: "classic" }` instead of a pack", but only `createDesignHandler` reads `body.from`; `PATCH /api/designs/{id} -d '{"from":"classic"}'` → a second 422, "send a name, a pack, or both". Executed both. The caller can still escape by sending a real pack, but the message's own remedy is inert on this endpoint. The guarding test (`tests/designs-api.test.mjs`) only exercises the create path. Fix: pass a flag so update omits the `from` clause.
- **`docs/DESIGN-SYSTEM.md:15, :57, :150`** — still lists `--surface-1/2` in the token table (this branch deleted `--surface-2`; no code uses it) and twice describes `.poster.is-canary`, which the branch removed and `TODO.md:120` ticks as done. The doc's own rule is "if a token is missing, add the token", so someone writes `var(--surface-2)` on trust and the declaration is silently dropped.
- **`docs/ARCHITECTURE.md:135-183`** — the Data and Components tables are written as complete enumerations (all eight OAuth tables, every component and its screen) and have zero hits for `designs`, though `schema.mjs:409` and `drizzle/0007_designs.sql` ship the table and `app/designs/*`, `app/api/designs/*`, `DesignGallery` and `DesignEditor` all exist. `AGENTS.md`'s module table likewise has no row for `lib/board/tint.mjs` or `lib/board/geometry.mjs`. Someone building an export or account-deletion path from the map misses a table of user data.
- **`TODO.md:121`** — ticks "`lib/board/face.mjs` turns a pack into the custom properties…" in the present tense about a file that `:277` of the same document records as deleted; it exists nowhere in the tree. Also `:191` lists match-day's `rows: 8` as outstanding (removed in 532ddf7) and `:300` cites `theme-pack.mjs:96` for a message now at `:110`.
- **`AGENTS.md:180` and `lib/board/flipboard.js:21-22`** both promise no frames when nothing changes. Harness with the Marquee tint: 300 frames over 5 simulated seconds, 209/299 pixel-identical to their predecessor, converging on ~90% once the tiles land, still armed at the end — `flipboard.js:508` draws unconditionally with no dirty check. Only Marquee among shipped presets does this (classic/canary/carnival have no tint; sorbet's is static). Either add a dirty check or amend both sentences.
- **`app/dashboard/page.tsx:37-41`** — the comment at `:34` says "one query per board"; `listQueue` (`queue.mjs:39-62`) is three, including an unbounded `select *` of every item, of which only `.slice(0,3)` of the text is used. 25 boards = 75 queries (concurrent under `Promise.all`, so bandwidth rather than serialized latency). Row volume is modest — the enforced caps are the type's `queuePolicy` (live `queueCap ?? 5`, max 50; scheduled 100), not `MAX_ITEMS=500` — so ~125 rows typical.
- **`lib/board/theme-pack.d.mts:77`** — `periodMs?: number` is wrong; both `validatePack` and `runnerGrid` (`tint.mjs:291-292`, returns null) require it. `:134` also declares `PACK_DEFAULTS` as `Pick<…'card'|'hinge'|'glyph'|'motion'|'fonts'>` while the real object carries `tint`, `flight`, `flightStrength`; nothing imports it, so typecheck is green and it is dormant.
- **`flipboard.js:294, :308`** — `JSON.stringify(spec)` for the cache key and a `perimeter(cols,rows)` allocation on every frame, just to read `.length`. Benchmarked at ~7ms CPU and ~7 MB nursery garbage per minute — noise, and it stops mattering entirely once finding 4 lands. Hoist if you're already in the file.

---

## What came back clean

- **Tenant isolation on the new `/api/designs` surface.** All five handlers gate on `getSession()` before touching the db, ownership is in the `WHERE` clause of all five queries, ids are 80 bits of `crypto.getRandomValues`, `ownerId`/`themeRev`/`template` are server-set and refused from a body, "not yours" and "does not exist" return identical text so nothing leaks existence, and every call is parameterised drizzle with no interpolation into SQL, HTML or a URL.
- **The migration.** `0007_designs.sql` is purely additive, its journal/snapshot chain is intact, and it applies cleanly to a database already holding a user, a queue and a board without touching them; cascade-on-owner-delete works.
- **Pack round-tripping.** `PACK_KEYS`, `mergePack` and `sparsify` all know `tint`/`flight`/`flightStrength`; every shipped preset round-trips (whole pack in → `themePack: null` out), and the design→board→`resolveBoardTheme` path preserves Marquee and Carnival field for field.
- **Additive-only contracts.** `/capabilities`, `/status`, `/queue` and the board AGENTS.md gain three theme ids and three config keys and nothing else.
- **Teardown of everything new.** Every new timer, observer and listener I traced — BoardApp's ambient interval, ThemePreview's IntersectionObserver/ResizeObserver/loop interval, ThemeSettings' designs fetch — has a matching cleanup, and no unbounded array or cache is introduced. (The board object itself, finding 4, is the one exception.)
- **Housekeeping.** 376 tests pass, typecheck clean, knip finds no dead files or exports, no added CSS class is unused, and the substantive claims in commits 98d6417, e63f086, 532ddf7, 1cf692a and 63350e2 all check out against the code.

**Housekeeping note from the security probe:** testing the live dev server needed an account, so `race-test@example.com` now exists in the local `./.pglite` dev DB and could not be removed (delete-user is not enabled); the test board and designs were deleted.

---

**Not safe to push as is:** close the protocol-relative URL hole at `lib/board/theme-pack.mjs:278`/`:285` first — it is a two-character regex change and it is the only finding that reaches an anonymous third party.