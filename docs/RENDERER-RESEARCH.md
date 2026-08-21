# Replacing pre-rendered tile art with a procedural renderer

*Research note, 2026-08-21. Prototype: [`docs/lab/procedural-tile.html`](lab/procedural-tile.html) — open it as a file, no server needed.*

> **Status:** phase 1 implemented on this branch — `Skin` seam in the engine,
> `SpriteSkin`/`ProceduralSkin`, `theme-pack.mjs`, `classic-p`/`canary-p`
> registered, `/lab/skins` fidelity bench. Default theme is still the sprite
> `classic` until the drawn one is signed off on a wall.

## Where we actually are

The board is **already one `<canvas>`** (`lib/board/flipboard.js`). What is
"video" about it is the art: every one of the 42 transitions is a clip the
designer rendered offline, which `tools/build_assets.py` turns into a 10-frame
WebP strip. The engine never knows what a flap looks like; it knows
`strips[state]`, `frame 0..9`, and does one `drawImage` per tile per frame.

That makes the coupling surprisingly thin. In the whole engine, the art format
is touched in exactly three places:

| Where | What it assumes |
|---|---|
| `Flipboard.draw()` | `drawImage(strips[tile.state], 0, tile.frame*size, …)` |
| `tick()` line ~380 | quantises progress to `tile.frame = 1 + floor(p * 9)` |
| `components/flapper/assets.ts` + `themes.mjs` | a theme is a folder of strips + manifest |

Everything else — the ring, retargeting-forward-only, per-band settling,
stagger, flap audio via `onFlap`, the `/status` lines — is renderer-agnostic.
**We are not replacing the engine; we are replacing `draw()`.**

The cost of the current approach is what the brief describes: a new theme is
42 clips from a designer (Canary took a Green.zip with its own quirks), a new
glyph is 2 clips minimum (in and out) and really a re-render of the ring,
and a colour change is a full re-render. Plus ~105 MB of decoded bitmaps per
theme per tab at 256px.

## What a flap is, visually

Unrolling `strip-01.webp` (A→B) shows the entire vocabulary:

- two half-cards on a horizontal hinge with a pin each side,
- the top half **falls forward**: it is the current glyph's top, vertically
  foreshortened by `cos θ` and darkened as it turns,
- past 90° it is the *next* glyph's bottom half, seen upside-down and
  unfolding, landing on the old bottom half,
- a soft shadow thrown onto the lower card while the flap is in the air,
- the top half behind the falling flap is already the next glyph.

That is about 30 lines of Canvas 2D. Every web split-flap in the wild —
[spite/SolariDisplay](https://github.com/spite/SolariDisplay),
[splitflap.org](https://splitflap.org/),
[this CodePen](https://codepen.io/branlok/pen/qBQEGJy), the
[GitHub topic](https://github.com/topics/split-flap?l=javascript) — draws it
procedurally; nobody pre-renders frames.

## Options

| Approach | Look-alike fidelity | Themeable from data | "Interesting" interactions | Perf at 20×8 | Fit with engine |
|---|---|---|---|---|---|
| **A. Procedural Canvas 2D** (prototype) | High — shading/shadow/foreshortening reproduce the clips; what it cannot do is the clips' subtle specular and motion blur | **Yes, entirely**: palette, font, radius, hinge, per-glyph overrides, image/SVG glyphs | Colour sweeps, per-tile effects, hover, mixed glyph art, mild pseudo-3D tilt | 160 tiles × ~6 draws, trivially 60fps; cards cached as offscreen canvases (~42 × size² × 4 B = 11 MB at 256, vs 105 MB today) | Drop-in: replace `draw()`, pass continuous progress instead of `frame` |
| B. DOM + CSS 3D (`transform: rotateX`, `preserve-3d`) | High, real perspective for free | Yes (CSS custom properties — palette swap is a stylesheet) | Real 3D tilt, DOM events per tile, accessible text in the DOM | 160 tiles × 4–5 elements, each with a transform — fine on a TV-class Mac/PC, **marginal on the Raspberry-Pi/Electron kiosk**; 3D layers eat compositor memory | Engine needs a DOM applier instead of a canvas; `tick()` unchanged |
| C. WebGL (three.js / regl) | Highest — real lighting, bevels, camera orbit, the "3D board you can walk around" | Yes (materials from JSON, glyphs as texture atlas) | Camera fly-throughs, depth-of-field, lighting moods, physics | Best raw throughput; costliest to build and to keep working on kiosk GPUs | Engine unchanged; renderer reads `tile.state/progress` |
| D. SVG + d3 | Medium (no shading without filters; filters are slow at 160 tiles) | Yes | d3 transitions, data-bound tiles | **Worst** — 160 animated groups with `feGaussianBlur` drops frames | Awkward: d3 wants to own the timeline the engine already owns |
| E. Keep sprites, **generate** them from a procedural renderer at build time | Identical to A | Yes | None beyond today | Same as today | Zero engine change; keeps the 105 MB and the build step |

On the d3 question specifically: d3 is a data-binding and scale/transition
library, not a renderer. The "d3-powered 3D flapboard" people picture is
really C (a three.js scene) or B (CSS 3D), possibly with d3 used for layout
scales and easing. It would not add anything A/B/C don't have, and SVG is the
slow path.

## Recommendation

**Do A now, design the theme format so C is possible later.**

1. A reproduces what we have, kills the asset pipeline for ordinary themes,
   cuts display memory ~10×, and is the smallest change to a tested engine.
2. The *theme pack* (below) is the real product surface. Written once for A,
   it is equally the material/glyph description C would consume; B and C are
   alternate renderers of the same pack, chosen per display
   (`settings.renderer`), not a rewrite.
3. Keep E as the escape hatch for art-directed themes: a pack may still ship
   **strips** (today's format) for a state, and the renderer composites them
   the same way — so the designer's Classic and Canary clips survive as the
   reference look, and a brand can still supply hand-animated glyphs.

### Theme pack (the thing a user uploads or builds on the site)

```jsonc
{
  "id": "acme", "name": "Acme", "version": 1,
  "ring": " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!()",   // optional; default is the 42
  "card":  { "fill": "#1d1d1f", "edge": "#0b0b0c", "radius": 0.05, "gap": 0.035 },
  "hinge": { "fill": "#2a2a2c", "pin": "#3a3a3c" },
  "glyph": { "fill": "#efe9df", "font": "700 0.86em 'Helvetica Neue', Arial", "stroke": null, "baseline": 0.53 },
  "motion":{ "flapMs": 70, "shading": 0.6, "shadow": 0.35, "perspective": 0 },
  "states": {                                      // per-glyph overrides
    "!": { "glyph": { "fill": "#d9381e" } },
    "(": { "art": "logo.svg" },                    // image/SVG drawn instead of text
    "Z": { "strip": "strip-26.webp" }              // hand-animated, today's format
  },
  "fonts": [{ "family": "Acme Sans", "src": "acme.woff2" }]
}
```

Validation belongs in `lib/board/` (pure, tested): ring closes and is unique,
colours parse, fonts/arts referenced exist, sizes capped. The "design
guideline" is then this schema plus a live preview — the prototype page is
already 80% of a theme editor (edit JSON, apply, watch it flip).

### What per-letter designs and palettes cost under A

- Palette swap: change four strings, rebuild 42 offscreen cards (~5 ms).
- New glyph: add a character to `ring` — the charset, layout, substitution
  table and API docs already derive from the manifest's cycle, so nothing
  else moves.
- Per-letter art: an `art` entry; drawn once into that state's card.
- Brand font: `@font-face` + `document.fonts.load()` before first card
  build; fallback stack in the pack.

## Migration plan (engine)

1. `flipboard.js`: replace `tile.frame` with `tile.progress` (0..1, already
   computed as `progress` in `tick()`); derive `frame` inside the sprite
   path only.
2. Extract `draw()` into a **skin** interface: `skin.drawTile(ctx, tile, x, y,
   size)` with two implementations — `SpriteSkin` (today) and
   `ProceduralSkin` (prototype). `setArt()` becomes `setSkin()`.
3. `themes.mjs` grows from `{id, path}` to a pack loader; `assets.ts` caches
   built cards per `(themeId, size)` the way it caches bitmaps today.
4. Fidelity gate: side-by-side page rendering the same message with both
   skins — this is a wall display, "looks right" is the acceptance test
   (`CLAUDE.md`). Tune `shading`/`shadow` until Classic is indistinguishable
   at TV distance.
5. Board config `theme` stays a string id; a user pack is `theme: "user:acme"`
   fetched from the API. Uploads are board-owner only, validated server-side.

## Risks

- **Fonts on the kiosk**: Electron bundle must ship the default face; card
  build must wait for `document.fonts`. Metrics differ per OS — hence the
  `baseline` factor in the pack.
- **Fidelity**: the clips have a specular highlight and slight motion blur the
  prototype lacks. Mitigate with a gradient on the falling flap and, if
  needed, a 2-sample blur (draw the flap twice at ±δθ at half alpha).
- **Memory under rebuild**: rebuilding cards on every resize at 4K — cache by
  size, debounce.
- **Per-glyph hand art** keeps the landing-seam issue (AGENTS.md); the
  strip-per-state escape hatch must keep the frame-9 == next-frame-0 rule.

## Prototype findings

`docs/lab/procedural-tile.html` (single file, ~150 lines) runs the engine's tick
logic verbatim, renders Classic/Canary look-alikes, a "Brand" pack (light
cards, Georgia, red `!`, green `0`, logo glyph for `(` `)`), and a tilt
variant, switching live from edited JSON. Confirmed in a browser: the settled
frame reads as the existing board; mid-flip fold, shading and shadow read as
a flap; all theme variation is data. One bug found and fixed during the
check: the top half must show the *current* card at rest and the *next* card
only once a flap is in flight.
