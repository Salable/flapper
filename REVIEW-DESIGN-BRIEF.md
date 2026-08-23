# Design review — brief

*The workspace brief for a general design review of Flapper: every document
that bears on the design, the implementation as it stands, and every piece
of media the app ships for theming and styling. Compiled 23 Aug 2026 on
branch `claude/design-review`; findings and fixes land on this branch.
File references are clickable paths; nothing here is a finding yet.*

## The design's thesis (as built)

A dark room with a split-flap board in it. One ground (`#0a0a0b`), bone ink
(`#ece7dd`), a single amber accent (`#d8b25a`) spent on attention, IBM Plex
Mono for labels and data with wide uppercase tracking, IBM Plex Sans for
prose, and the board itself as the brand — the wordmark is the real engine,
the create-flow posters are CSS tiles, motion is the flap and nothing else.
The review's job is to test that thesis everywhere it is applied: where the
app drifts from it, where the system has grown two ways of doing one thing,
and where the thesis itself should bend (a light theme? a marketing
surface?).

## 1. Read first — the documents that define the design

| Document | What it holds | Review for |
| --- | --- | --- |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) | tokens, the component table, the standing rules ("Forms hold focus", "Buttons own their ink", per-board media as token overrides) | are the rules still the right rules, and are they followed |
| [docs/SCREENS.md](docs/SCREENS.md) | every screen and its job, cross-cutting patterns, deliberate seams | does each screen still earn its description |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the map: frameworks, flows, every component with its screen, delivery | context; the component inventory to walk |
| [docs/RENDERER-RESEARCH.md](docs/RENDERER-RESEARCH.md) | why tiles are drawn from theme packs, the pack schema's origin, measured Classic values | the visual ground truth for the board itself |
| [docs/BOARD-API.md](docs/BOARD-API.md) + [lib/api/agents-doc.mjs](lib/api/agents-doc.mjs) | the written voice of the product toward agents | tone and copy consistency with the UI |
| [SPEC.md](SPEC.md) | the asks as made, what shipped, launch readiness (legal), the open list incl. layout-picker asks 20–22 | the queue of known design debts |
| [AGENTS.md](AGENTS.md) §"Add a theme", §"Conventions worth keeping" | the theming contract and the uppercase/consent/degrade conventions | conventions worth promoting into DESIGN-SYSTEM.md |

## 2. The implementation — where the design lives in code

### Tokens and stylesheets

- [app/design-tokens.css](app/design-tokens.css) — **41 tokens**, 94 lines:
  grounds (incl. the three `--tile-*` faces), ink, four signals, two type
  stacks and five sizes, two tracking registers, a 7-step space scale, three
  radii, and the flap motion pair (`--ease-flap`, `--ease-settle`). This is
  the whole vocabulary; everything else should derive from it.
- [app/ui.css](app/ui.css) — 547 lines, the `ui-*` design-system classes
  (buttons, fields, tabs, modal, segmented, miniboard, color input).
- [app/board.css](app/board.css) — 1,664 lines, everything else: the display
  chrome, landing, dashboard, settings, rails, theme editor, legal footer.
  **Three times the size of ui.css and organically grown — the review should
  ask what in here is secretly a component.**
- Uppercase-with-tracking appears **25 times** across the two sheets; the
  data-vs-label rule is now codified (`input`/`textarea` reset it,
  `.as-board` opts back in) but the label register itself is worth one pass.
- **There is no light theme and no `prefers-color-scheme` anywhere.** The
  wall product is dark by nature; the *website* (docs, legal, signup) being
  dark-only is a decision the review should make deliberately.

### The two form systems (known drift)

The design system's `ui-*` controls ([components/ui/Field.tsx](components/ui/Field.tsx))
coexist with the older raw classes (`.field`, `.config-grid`, `.actions` in
board.css). Still on raw classes: [components/AuthForm.tsx](components/AuthForm.tsx),
[components/DisplayConfig.tsx](components/DisplayConfig.tsx),
[components/QueueManager.tsx](components/QueueManager.tsx). Newer work
(TypeSettings, ThemeSettings, ScheduleEditor) uses `ui-*`. Unify or bless.

### Inline-style islands

14 `style={{…}}` sites across 10 components (largest:
[components/NewBoardClient.tsx](components/NewBoardClient.tsx),
[components/ThemeSettings.tsx](components/ThemeSettings.tsx),
[components/flapper/ThemePreview.tsx](components/flapper/ThemePreview.tsx)).
Some are genuinely dynamic (canvas sizing, `--flap-i` staggers); some are
layout that belongs in the sheets. Sort them.

### Components

The full inventory with screens is the table in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §Components. The design-system
primitives are [components/ui/](components/ui/): `Button`, `Field` + five
controls, `ColorInput`, `Tabs`, `Modal`, `ConfirmDialog`, `bits.tsx`
(`Card`/`Chip`/`Segmented`/`EmptyState`/`CopyButton`/`KeyReveal`),
`MiniBoard`. The brand-bearing ones are [components/flapper/](components/flapper/):
`Flapper` (the engine in a box), `ThemePreview`, `assets.ts` (skin loader),
`rasterize.ts` (uploads → pack art). [components/SiteFooter.tsx](components/SiteFooter.tsx)
is the newest chrome and the least designed — one rule block, placeholder
copy in it.

### Screens to walk, in order

`/` → `/signup` (consent boxes) → `/dashboard` (cards + Connections) →
`/new` (rails, posters, detail panel) → `/b/{slug}` (the display; F/Esc/M) →
`/b/{slug}/settings` (Queue as one block; Display: layout picker + **theme
editor** + sliders; General) → `/account` (Privacy & data) → `/docs` and
`/docs/architecture` → `/legal` (placeholder banners) → `/consent`.

## 3. The media inventory — everything shipped for theming and styling

| Asset | Where | What it is | Notes for review |
| --- | --- | --- | --- |
| **Theme presets** | [lib/board/themes.mjs](lib/board/themes.mjs) | Classic and Canary as validated theme packs (data, not files) | the measured Classic values are the reference look |
| **Pack schema + defaults** | [lib/board/theme-pack.mjs](lib/board/theme-pack.mjs) (+ `.d.mts`) | every themable field and its range: card, hinge, glyph, motion, per-state overrides, `art`, `fonts` | is the field set right? what's missing (per-band? background)? |
| **Per-board packs** | `boards.config.themePack` (DB, sparse) via [lib/board/board-theme.mjs](lib/board/board-theme.mjs) | user themes as diffs; inline art as data URIs ≤ 16 KB, ≤ 8 per pack, keyed by ring index | limits sane? preview of *stored* packs anywhere? |
| **Tile glyph font** | [public/fonts/arimo/](public/fonts/arimo/) | Arimo 400/500/700 woff2 (~11 KB each, latin), Apache 2.0, licence + provenance beside them | the only bundled face for the glass; editor also offers system Georgia/Courier/system-ui |
| **UI fonts** | next/font in [app/layout.tsx](app/layout.tsx) | IBM Plex Mono + Sans, self-hosted at build | the chrome's voice |
| **The clacks** | [public/audio/flap.wav](public/audio/flap.wav) + [manifest.json](public/audio/manifest.json) | one 67 KB WAV sprite: 16 single-flap samples, 24 kHz mono; voiced/panned by [lib/board/audio.mjs](lib/board/audio.mjs) (subtle ±0.35 image) | sound is themable in principle (a sprite per voice) but not yet a pack field — candidate from the clack catalogue work |
| **Favicon** | [app/icon.svg](app/icon.svg) | hand-authored tile "F", token colours copied by hand | update if tokens ever move |
| **Desktop icon** | [build/icon.icns](build/icon.icns) (1 MB, committed) | built by [tools/build_icon.py](tools/build_icon.py) from the designer's source GIFs — which are **not in the repo** (gitignored `A-Z 0-9/`, on the designer's machine) | the only remaining tie to the original art; regeneration needs that folder |
| **CSS tiles** | [components/ui/MiniBoard.tsx](components/ui/MiniBoard.tsx) + `--tile-*` tokens; `.poster.is-canary` override in [app/board.css](app/board.css) | the server-renderable brand mark and the `/new` posters | poster colours are hand-copied from Canary, keyed on the literal id — deriving them from the pack is a known follow-up |
| **Prototype** | [docs/lab/procedural-tile.html](docs/lab/procedural-tile.html) | the standalone procedural-tile prototype that decided the renderer | historical; linked from the research note |
| **Clack catalogue** | Claude artifact (session 22 Aug): ten metric-picked clack samples, playable as board sweeps | input for a future "sound" pack field; not in the repo |
| **Legal pages** | [docs/legal/](docs/legal/) via [lib/legal/documents.mjs](lib/legal/documents.mjs) | five placeholder documents with amber banners | the banners and footer are new chrome — style pass |

Gone on purpose (don't look for them): the sprite strips and
`tools/build_assets.py` — see the research note's outcome block.

## 4. Questions this review should answer

1. **One form system.** Migrate AuthForm / DisplayConfig / QueueManager to
   `ui-*`, or bless the raw classes as the "dense settings" register?
2. **Dark-only.** Is the website (not the wall) staying dark? If yes, write
   it into DESIGN-SYSTEM.md as a decision; if no, the token file is the
   seam.
3. **board.css at 1,664 lines.** What in it is a component wanting to be
   born (the settings block? the rails? the legal footer?), and what is
   dead weight the next screen shouldn't inherit?
4. **The landing page and footer.** The landing is one hero and two CTAs;
   the footer is one unstyled line of placeholders. Are they *finished* or
   just first?
5. **Posters from packs.** `/new`'s cards should take their colours from the
   template's theme pack rather than a hard-coded `.is-canary` — worth doing
   now that packs are the source of truth?
6. **The theme editor as a design surface.** It exposes every pack field as
   sliders and colour wells — is that the right shape, or does it want
   curated "looks" first (a preset gallery) with the fields behind Advanced?
7. **Sound as theme.** The clack is one voice for every board. Should
   `sound` join the pack (voice, gain, pan width), seeded by the catalogue's
   seven candidates?
8. **Uppercase register.** Labels at 10 px with 0.16 em tracking are the
   voice of the app — audit readability at small sizes and on the legal
   pages where there's real prose.
9. **Accessibility debts, gathered**: SPEC §7 (screen-reader card names,
   already re-tested once), layout-picker asks 20–22 (keyboard, numeric
   readout, aspect), focus-visible coverage on the newer chrome
   (`SiteFooter` links, theme ring cells).
10. **Empty, loading, failed.** The display's overlays, the dashboard's
    three empty states, ThemePreview's error line — one pass for tone and
    consistency ("Loading board", `flapper:` errors, the degrade sentences).

## 5. How to run it

```bash
npm run dev          # walk the screens in §2 against localhost:3000
npm test             # 323; the design-adjacent suites: theme-pack, board-theme,
                     # theme-editor, legal, templates, audio
```

The board itself is judged on a wall: open a display fullscreen, post with
the curl from settings, and use Settings → Display → Theme's live preview
for pack work. For stored-pack review on production, `GET /api/b/{slug}/theme`
returns any board's resolved pack.
