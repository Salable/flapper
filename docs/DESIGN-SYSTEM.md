# The Flapper Design System

Flapper's look is the board's own world: **the black of the glass, the bone
of the painted flaps, the amber of a departure warning.** Every screen is a
room the board hangs in. This document is the contract for building anything
visual in Flapper — screens, components, and future board types.

## Tokens (`app/design-tokens.css`)

All color, type, spacing, and motion come from CSS custom properties. A
component **never invents a value** — if a token is missing, add the token.

| Group | Tokens | Notes |
| --- | --- | --- |
| Grounds | `--bg`, `--surface-1/2`, `--tile-hi/lo`, `--edge`, `--edge-strong`, `--shade` | `--bg` is the room; surfaces are panels/cards |
| Ink | `--ink`, `--muted`, `--faint`, `--ink-inverse` | bone on black; inverse for amber/bone grounds |
| Signals | `--amber` (brand/attention), `--live`, `--danger` | semantic — never decorative |
| Type | `--font-mono`, `--font-sans`, `--text-xs…xl`, `--track-label`, `--track-display` | IBM Plex Mono carries labels/data; Plex Sans carries prose |
| Space/shape | `--space-1…7`, `--radius-sm/md/pill` | 4px base grid |
| Motion | `--flap-ms`, `--flap-ms-slow`, `--ease-flap`, `--ease-settle` | see Motion |

## Type rules

- **Mono, uppercase, tracked** (`--track-label`) for labels, buttons, table
  heads, section titles — the voice of the machine.
- **Sans** for running prose, hints, and anything longer than a phrase.
- The wordmark register (`--track-display`) is reserved for `MiniBoard`.

## Motion: the flap

Movement quotes the mechanism — a flap falls fast and lands with a slight
catch. One keyframe (`flap-in`, a perspective half-flip from above) covers
entrances: modals, tab panels, hero tiles. Stagger children with
`--flap-i`. Rules:

1. Entrances only — never on data refresh or hover.
2. One orchestrated moment per screen beats scattered effects.
3. `prefers-reduced-motion` disables it globally (already handled).
4. Durations/easings come from tokens; nothing hand-tuned inline.

## Components (`components/ui/`)

| Component | Use |
| --- | --- |
| `Button` / `LinkButton` | every action; variants `default/primary/ghost/danger` map to intent |
| `Field` + `TextInput/Select/TextArea/RangeSlider/Checkbox` | every form control |
| `Tabs` | sectioned screens (Settings) |
| `Modal` | anything that interrupts; arrives with a flap |
| `useConfirm` | destructive/irreversible actions — **native `confirm()` is banned** |
| `Card`, `Chip`, `Segmented`, `EmptyState` | layout & state vocabulary |
| `CopyButton`, `KeyReveal` | credentials and copyable values |
| `MiniBoard` | text as CSS split-flap tiles — the server-renderable stand-in and loading fallback for `Flapper` |

Screen-level scaffolding: `.app-shell` + `AppBar` (brand left, context
right), `.dash` content column. Board-type-specific UI lives in
`components/board-types/<id>/` and composes these primitives.

## The flapper as a component (`components/flapper/`)

The brand mark is not a picture of the product — it is the product.
`Flapper` runs the real engine (`lib/board/flipboard.js`, the same tile
art and motion as a display) in an embeddable box:

```tsx
<Flapper text="FLAPPER" tilePx={22} />          // the app bar
<Flapper text="FLAPPER" tilePx={48} />          // a hero
<Flapper text="ON AIR" tilePx={30} ambient={false} />  // a still sign
```

- **Assets are shared**: `components/flapper/assets.ts` fetches and decodes
  the manifest + strips once per tab; every flapper (the display included)
  uses the same bitmaps, and nothing ever closes them.
- **It server-renders as `MiniBoard`** in the same footprint, then the
  canvas takes over — the swap is a settle, not a jump.
- **It animates itself**: text flips in from blank on mount, and the
  ambient loop keeps it alive — occasional single-tile misfires that
  correct with a full revolution, and a whole-board sweep about once a
  minute. The choreography is pure and tested (`lib/board/idle.mjs`);
  the component only applies it. `prefers-reduced-motion` gets the text
  immediately and no ambient loop.

Restraint is part of the design: at rest the mark is mostly still, the
way a real board is.

## Buttons own their ink

A `.ui-btn` never inherits contextual text color. Page CSS that colors
links in a region (`main.landing a`, `.auth-form a`, …) must exclude
buttons — write `a:not([class*='ui-btn'])` — and `ui.css` pins every
variant's color at anchor+class specificity as a backstop. The concrete
case this rule exists for: the landing page's **Create account** button is
dark text (`--ink-inverse`) on the bone ground, and a region link rule
once turned it bone-on-bone.

## Adding a component

1. Build it from tokens; put styles in `app/ui.css` under a `ui-` class.
2. Server-safe unless it needs interactivity ('use client' only when true).
3. Add it to the table above with a one-line "use".
4. If it expresses state (live/paused/error), use the signal tokens, never
   new colors.

## Ahead: per-board media

Board creation will eventually accept custom media (tile art, palettes) —
the token layer is the seam: a board skin overrides tokens, components don't
change. Keep components token-pure so that day is cheap.
