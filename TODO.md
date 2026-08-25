# TODO — the sheets and designs direction

*Written 24 Aug 2026 on branch `claude/design-pass`, out of a working session on
the control room. It records decisions that were made, not options that were
considered, so that the building can be checked against something. Where a
decision is still open it says who it belongs to.*

Related: [SPEC.md](SPEC.md) is the older ask ledger (the layout-picker asks
20–22 live there, and 20 and 21 are now done). This file is the newer direction
and supersedes SPEC's assumption that a board is a queue you manage.

---

## The model, as decided

**A board is a deck of sheets.** A sheet is one thing the board shows. Sheets
*persist* — the board cycles Sheet 1 → 2 → 3 → 1 forever, and a board with one
sheet is a standing sign. This is the queue's existing looping behaviour made
the default rather than a per-message toggle, so `↻` stops being a row action
and the two-line Loop paragraph goes away.

**The tabs are the sheets.**

```
┌────────────────────────────────────────────────────┐
│ FLAPPER      Carrow Road ⧉            [OPEN DISPLAY]│   logo = back
├────────────────────────────────────────────────────┤
│  SHEET 1 │ SHEET 2 │ API │ + ADD SHEET             │
└────────────────────────────────────────────────────┘
```

Tab order is play order, reordered by dragging the tabs — which retires `↑` and
`↓` from the row actions, leaving edit and remove.

**A sheet has a source.** What the sheet shows comes from somewhere, and that
somewhere is a property of the sheet, not a mode of the board:

| Source | The words come from | State |
| --- | --- | --- |
| Typed | you, typing on the board | **done** — the preview is the typing panel |
| Pushed | an agent posting to that sheet | close: one addressable slot per sheet over the existing queue |
| Fetched | Flapper calling a URL | its own project — see Open questions |
| Clock | the time, re-rendered as it ticks | parked, its own design |

Ambient motion while a board holds is **done**: `config.ambientMs`, off by
default, wired in the display rather than the player.

A board of typed sheets is manual. A board of one pushed sheet is what "driven
by the API" means, and it needs no mode flag. A mixed board alternates, and
per-sheet dwell is what makes "a minute of each" work — no new machinery.

Because the source is per sheet, the `template` / `api` / `ui` tag on a queue
row stops being needed: the sheet's own kind says where its words come from.

**Designs are a library, in their own place.** Not a tab among the sheets,
because a design is a thing you make once and apply to many sheets. Ten or so
shipped, plus new ones. Two families, because the ink has to read against the
card: dark tiles with bone ink, pastel tiles with black ink.

**A sheet picks a design** — but from a small set per board, not freely. The
renderer caches all 42 card faces as bitmaps (~11 MB at 256 px) and rebuilds
them when the design changes. Rebuilding between every sheet, every cycle,
would stall the flap on the kind of hardware a wall runs on. Holding several
skins resident costs ~11 MB each, so the honest ceiling is three or four
designs per board.

**A tint is a colour per cell** — a wash across the grid. Stored as the formula
(two colours and an angle) rather than the grid it produces, composited over
each card at draw time so the card cache stays shared. `overlay` protects a pure
black or pure white glyph, so the letters stay readable while the face takes the
hue. Gradients, photographs and logos are all the same feature: whatever fills
the `cols × rows` colour grid, the renderer cannot tell the difference.

---

## Work list

### Done on this branch

- [x] Split-screen design surface — sticky preview beside the controls (`c7ab43a`)
- [x] Type directly on the preview board; "Put this on the board" sends it (`c7ab43a`)
- [x] Screen shape as a board property; rows derived from cards across (`3add914`)
- [x] The layout stage takes the screen's shape and shows the letterbox — SPEC ask 22 (`c7ab43a`)
- [x] Keyboard and numeric readout on the layout picker — SPEC asks 20, 21 (`383e6f0`)
- [x] Per-cell tint, gradients, and Sorbet as the first pastel design (`9f6b254`)
- [x] Board card says Edit, not Settings (`9baf778`)
- [x] A wash you can author, not just one that ships (`8a01dae`)
- [x] CSS tiles wear any design; nothing keyed on a theme id (`23f2d56`)
- [x] The Display tab dissolved: Start from and Fidget move into the board's
      own sidebar, composing moves onto the board itself (click the canvas
      and type; rows mode, not text mode, so Align/Vertical/Wrap have nothing
      left to decide) (`2571577`)
- [x] The duplicate Screen/Card size editor removed from the (now-gone)
      Display tab; a live 422 on it and a `setConfig` lost-update race both
      found and fixed in the same pass (`31f8c5b`)
- [x] Four more design fonts, self-hosted like Arimo: Work Sans, Source
      Serif 4, IBM Plex Mono, Oswald - and the Face dropdown fixed so
      picking one actually loads it (`b83e193`)
- [x] Click-canvas composing (`2571577`, above) reverted: no cursor, no
      selection, no paste, backspace only ever eats the last character
      typed - unpleasant to actually write in. ComposeModal instead: `text`
      mode restored (Align/Vertical/Wrap are back, and matter again), and
      the textarea itself is the board rather than a second thing beside
      one - a fixed cols x rows box, a dot for every cell nothing has
      reached, Align as its own `text-align`, Vertical as where a flex box
      puts it. A first pass showed a real preview canvas above the
      textarea and asked the same three questions twice; dropped in favour
      of the one honest view.
      Found and fixed along the way: `.flap-in`'s entrance animation held a
      non-`none` transform forever after finishing (`animation: ... both`
      fills forward, and a CSS Animation's "none" is an identity matrix, not
      actually `none`) - a real transform, even an identity one, makes its
      element the containing block for `position: fixed`, so every modal
      opened from inside a settled tab panel, rail card or dashboard row was
      confined to that element's box instead of the viewport. And the
      global `textarea { flex: 1 }` rule (meant for textareas in a settings
      form row) fought the compose box's own auto-grow, always filling it
      full-height regardless of how little was typed - overridden with
      `flex: none` on this one.
      The box was fixed-font-size (16px) as well, which did not survive
      contact with every card size: `cols` runs 8 (huge) to 48 (tiny), and
      at 16px a tiny board's grid ran 650px tall, pushing Align/Vertical/
      Wrap and the send button below the fold - and a `overflow-y:auto`
      modal hid rather than solved that, since nothing said there was more
      below. Font size is fitted to a footprint now (fontSizeFor, clamped
      9-16px), so the box stays a sane, submittable size at every card
      size instead of growing unbounded with `rows`.

### Next — the designer suite

Building it was also how we found what was still hard-coded. All four are now
done; what remains is the gallery and the designs themselves.

- [x] **A tint editor** — the Wash group in the theme editor: none or gradient,
      two stops, an angle, a strength, and how it applies (`8a01dae`).
- [x] **The design gallery** — /designs, every design as real tiles, reachable
      from the dashboard; "make a board in this" carries the design through
      creation (`2cb9dc0`). Read-only until designs have somewhere to be saved.
- [x] **Authoring a design outside a board.** Designs live on the account:
      `designs` table, `/api/designs` CRUD, and the gallery lists yours beside
      the ones in the box. Made in the designer view or by an agent posting a
      pack - the same door and the same validator, which names every problem at
      once so something writing a pack can fix it in one go. A board stores the
      pack it was given rather than a link, so editing or deleting a design
      never reaches a wall.
- [x] **A board card shows its board.** The dashboard leads each card with the
      board itself, in its own design, showing what is on it - so two boards are
      told apart by looking rather than by reading.
- [x] **Editing a design's pack.** `/designs/[id]` opens the same editor that
      dresses a board, saving the whole pack to the design instead of a sparse
      diff to a board. Same job, different destination.
- [x] **Applying a design to a board you already have** — Start from lists
      yours beside the ones in the box.
- [x] **Renaming one** — inline on its card.
- [ ] **Eight more designs.** A design is validated data, not code, so these are
      authoring. Split across the two ink families.
- [x] **The poster keyed on the string `'canary'`** — now resolves the
      template's pack (`23f2d56`).
- [x] **`.poster.is-canary` restating the pack in CSS** — deleted (`23f2d56`).
- [x] **The MiniBoard's tile face baked as Classic** — `lib/board/face.mjs`
      turns a pack into the custom properties the tile rules read, wash
      included; no pack still means the tokens, so the wordmark is unchanged
      (`23f2d56`).

### Then — sheets

**Worth re-reading before starting this: "the sidebar dissolves" was written
before the sidebar existed.** It is now where Design, Screen, Card size and
Fidget live - the single place that answers "what does this board look
like" - and per-sheet design (below) means a sheet, not the board, will be
what wears a design. Building this as originally imagined would undo real
work from 25 Aug 26, not just move it; worth a fresh look at what the
sidebar becomes rather than assuming it goes.

- [ ] Sheets replace the Queue tab; tabs are the deck; drag to reorder
- [ ] Sheets persist and loop by default; retire `↻` and the Loop paragraph
- [ ] Board name and copy-link into the app bar; the sidebar dissolves - see
      note above, this needs deciding again, not just doing
- [ ] One addressable slot per sheet, so a pushed sheet is a real source
- [ ] Per-sheet design, capped at a few per board
- [ ] Move queue size next to the sheets, out of General → Type settings
- [ ] Decide where board admin lives once the tab bar is sheets (see below)

### Bigger, each its own branch

- [ ] **Square or slightly tall cards.** `drawTile(ctx, state, progress, x, y, size)`
      is one `size` "filling the square", the card cache is `size²`, and every
      pack metric is a fraction of that one edge — including the flap's own
      vertical scaling. `rowsThatFit` already takes `cardAspect` and the test
      covers it, so the geometry is ready; the skin contract is not.
- [ ] **Photographs and logos on the board.** Draw the image into a
      `cols × rows` canvas, read it back, feed the same tint grid. The browser
      does the downsampling, which is exactly the roughness wanted. Small work
      on top of what `9f6b254` already built.
- [ ] **Fetched sheets.** Turns Flapper from a thing you push to into an HTTP
      client: polling, credentials for other people's endpoints, response
      mapping, timeouts, stale data, and a new outbound surface from the server.
      Weeks, and its own decisions.
- [ ] **A clock or countdown sheet.** The board-type contract already has a
      `playback: 'clock'` machine with `itemAt()` — that is how Scheduled picks
      the active message from the time. What is missing is a sheet whose
      *content* is the time, re-rendered as it ticks. Parked as its own design.
- [ ] **Movement.** A shape gliding and bouncing around the grid. As a moving
      *tint* it is cheap and smooth — recompute the grid per frame, no tiles
      flip. As moving *glyphs* it is bound by flap physics: a tile only advances
      forward through 42 states, so it would be slow and clack constantly.
      Note that the render loop currently stops when nothing is animating
      (`flipboard.js` `stop()` / `isAnimating()`), so a continuous animation
      means keeping it running — worth capping the rate on wall hardware.

---

## Named for the mechanism, not the thing

A board's type is `live` or `clock`, surfaced as three cards - Live queue,
Scheduled, Shared screens - and the whole thing is confusing. Shared screens is
`{...scheduled}` with a different name and no behaviour of its own, so a third
of the choice is noise. And both real names describe how the machine works
rather than what you end up with.

The commonest wall in the world is a **standing sign**, and it is not an option:
you get it by making a live queue and letting it drain. So the list should
probably be three intentions rather than two mechanisms, which is also exactly
what sheets give:

| | What it is | Underneath |
| --- | --- | --- |
| A sign | Says one thing until you change it | live, one looping sheet |
| A cycle | Rotates through a few things | live, several looping sheets |
| A timetable | Shows things at times of day | clock |

Sync stops being a type and becomes a sentence about timetables.

- [ ] Fold Shared screens into Scheduled, or give it something Scheduled has
      not got - per-screen layouts off one schedule was the thing it was
      assumed to mean, and would be worth having
- [x] Make a standing sign a first-class choice rather than a drained queue -
      done differently than imagined here: not a fourth board type, but a
      `live` board with `queueCap: 1`. The panel derives from the cap, not a
      template id, so raising it brings the queue back (`246a6e4`)
- [ ] Rename the types for intention - still open
- [x] `match-day`'s config no longer sets a grid at all - it sets
      `cardSize: 'small'`, and the grid is worked out from that and the
      board's screen (`4313bac`)

## Transitions and washes

Half of this exists: `sweepMs` and `staggerMode` (diagonal, column, row,
random, none) already shape the wave as tiles flip - per design now, in its
own Advanced group, not per board. A rainbow or an explosion wash is the
colour version of the same idea, riding the tint grid - recompute it per
frame with the wave moving through it, which is the same mechanism as a
moving tint.

- [ ] **Washes as transitions.** Procedural ones (a rainbow along an axis, an
      explosion from the centre) work at any cols x rows, because the grid is
      always known. A hand-authored effect, tuned for one geometry, is the case
      that would need a fixed screen ratio - so that constraint applies to
      authored transitions, not generated ones.

## A size, not a grid — done

Nobody wants to choose 24 columns. They want cards a certain size on a certain
screen, and the grid is the *consequence* - which matters more here than in most
layout problems, because a split-flap board cannot reflow. The grid is not a
layout choice, it is a physical fact about a wall, and asking somebody to pick it
is asking them to do the arithmetic the app already does.

Built exactly as described below, in the geometry rework
(`4313bac`..`31f8c5b`): `cardSize` (Huge/Large/Medium/Small/Tiny) and `screen`
(a shape - any two numbers, Custom included) are the only two things a board
records; `cols`/`rows` are never stored anywhere, and the API refuses them
outright if sent. The table held up exactly - verified against the real
function, not just sketched:

| Card size | 16:9 | 4:3 | 9:16 | Square |
| --- | --- | --- | --- | --- |
| Huge | 8 × 5 | 8 × 6 | 8 × 14 | 8 × 8 |
| Large | 12 × 7 | 12 × 9 | 12 × 21 | 12 × 12 |
| Medium | 20 × 11 | 20 × 15 | 20 × 36 | 20 × 20 |
| Small | 32 × 18 | 32 × 24 | 32 × 40 | 32 × 32 |
| Tiny | 48 × 27 | 48 × 36 | 48 × 40 | 48 × 40 |

- [x] Replace "cards across" with a card size, and show the grid it produces
      (`4313bac`)
- [x] An escape hatch for a board that wants something other than the five
      sizes - not a raw grid number, a Custom **screen** instead: any two
      numbers, any units. Between five card sizes and an unlimited screen
      shape there is no combination the five sizes alone couldn't reach
      (`2706326`).

## Several screens, several versions

The better answer to the Shared screens problem. Today that type is
`{...scheduled}` with no behaviour of its own, and the thing it *should* mean
is: this board lives on three screens, so it is three versions of one thing,
edited independently and kept as a package.

The reason it cannot just be one layout stretched three ways is the same reason
the grid is not a layout choice - a board does not reflow. Where a line breaks
on a 16:9 wall is not where it should break on a portrait panel, and no rule
gets that right for real words. Somebody has to look at each one.

So: a board has screens; a screen has a shape and its own laid-out version of
each sheet; editing one does not touch the others; they play in step because
the clock says so, which is the one thing Shared screens already does.

- [ ] Decide whether this replaces the Shared screens type or subsumes it
- [ ] A sheet with per-screen versions is the same shape as a sheet with a
      per-sheet design (see the sheets section) - worth building them together

## Big letters

A glyph spanning 2x2 tiles, the way a real board uses dedicated large-character
units. Worth having and it lands on one of two hard things:

- **Quarter-glyph states.** Four tiles each showing a corner of a letter, which
  means new states on the ring - and the ring is refused for now, because
  `/capabilities`, the substitution table and every board's AGENTS.md derive
  from it (see "Refused by design" below).
- **Merged cells.** The renderer draws one glyph across a 2x2 block, which means
  the board gains a notion of a cell that is not one tile. That reaches the
  layout engine, the row/col model the API speaks, and what `GET /status`
  reports as `lines`.

There is a third, cheaper path for a *fixed* big word rather than a general
mode: `art` already puts an image on a state instead of a glyph, so four art
tiles can be four quarters of one letter today - within the pack's limits of
eight art entries at 16 KB each. Enough for a demo or a logo, not for typing.

- [ ] Decide which of the two real routes, or ship the art trick as a
      deliberate "big word" feature and leave typing alone

## Board motion belongs to the design, not the board

*Worked out 25 Aug 2026, field by field, against the Display tab's "The board
this makes" group. Built the same day, in `6aeb2a1` - what was banked as "a
separate PR" turned out to fit on this branch after all.*

Six of the ten fields there describe how the physical board moves, not what a
particular board is showing, and belong in the design instead: **Hold**
(`dwellMs`), **Scroll speed** (`fastStepMs`), **Landing** (`landStepMs`),
**Sweep** (`sweepMs`), **Sweep shape** (`staggerMode`), **Always flip**
(`alwaysFlip`). Two of those are already shared machinery, not just
similar in kind: the fidget system's own "sweep" idle action borrows Sweep,
Sweep shape and Always flip rather than owning copies, so a design's value is
the only one that will exist once this lands.

Three stay exactly where they are, per-board and per-slide, WYSIWYG: **Align**,
**Vertical**, **Wrap** - they describe how this content sits, not how the
board moves.

**Fidget** stays a per-board setting, in its own section - some walls want a
quiet board and some want personality, regardless of which design is worn. It
stops carrying its own Sweep/Sweep shape/Always flip and reads whichever
design the board wears for them when it acts.

**Hold** specifically: hidden entirely on a static board (a sign). Verified
end to end that it fires a repeat cycle every interval with no visible effect
there, since there is nothing to hold between. The per-message Hold override
already in the compose panel (Board default / 1s / 2s / 5s / 10s / 30s) is the
per-slide override this already wants and needs no new work beyond falling
back to the design's Hold instead of the board's.

- [x] A new pack section for the six fields - called `advanced` for now.
      No existing section fit: `motion` was already taken, for the flip's
      lighting (shading/shadow/highlight/perspective) (`6aeb2a1`).
- [ ] Rename **Scroll speed** - it is the mid-flip cycling speed, not
      scrolling (see "There is no scrolling" below). Still open; naming was
      deliberately left for later.
- [ ] Rename **Always flip** - flagged as unclear. What it does: force every
      tile through a full revolution even when the letter is unchanged, as a
      permanent style choice. Still open, same reason.
- [x] The compose panel's "Hold: Board default" falls back to the design's
      Hold rather than `config.dwellMs` - not a separate change: the
      controller's own default dwellMs is populated from the resolved pack
      (`advancedFrom`), so "board default" already means the design's Hold
      (`6aeb2a1`).
- [x] Hold hidden wherever it is offered on a static board - the compose
      panel and the sidebar (Display no longer exists) (`6aeb2a1`, `2571577`).
- [x] Fidget's sweep action reads the resolved pack's Sweep, Sweep shape and
      Always flip rather than its own copies - also not separate work: the
      board's own opts (which the fidget system reads) are populated from the
      resolved pack, so there is only ever one copy (`6aeb2a1`).

## Left by the code review

- [x] **`lib/board/face.mjs` had no production caller** — deleted, with its
      test and the CSS-tile design plumbing. The dashboard's cards were the
      candidate caller and they draw on a canvas instead, which shows a design's
      behaviour as well as its colours. The canvas won on every surface, so a
      CSS tile in a design has nowhere left to be wanted.

## Open questions — yours

1. **Where board admin lives** once the tab bar belongs to the sheets. Slug,
   privacy, pause, export and delete need a home; a gear at the end of the tab
   bar was the leading idea and was not settled. The API key is *not* part of
   this — it belongs to the API sheet that uses it.
2. **Designs on the account or on the board.** Account-level makes one Carrow
   Road design reusable across every board, which is what a brand kit is for,
   and needs a table and a migration. Board-level reuses today's sparse pack in
   `config.themePack` and means rebuilding the same green tiles every time.
3. **Pushed vs fetched** for "a sheet is an API call" — the first is about a
   day's work on rails that exist, the second is a project. Both are worth
   having; the first is worth having first either way, because a fetched sheet
   is a pushed sheet where Flapper does the pushing.
4. **Canary's glyphs are illegible below ~40px tiles, and it is not the font.**
   `themes.mjs` — `glyph: { fill: 'transparent', stroke: '#ffffff', strokeWidth:
   0.022 }`. It uses the same Arimo every other design does; a transparent fill
   traced by a stroke 2.2% of tile width goes sub-pixel on a small board
   regardless of typeface. Fixable with a solid fill or a heavier stroke -
   not done, since it changes how Canary looks.

## Refused by design, not missing

- **New states on the ring.** `theme-pack.mjs:96` — `ring cannot be changed by
  a pack yet`. The ring is server-side and `/capabilities`, the substitution
  table and every board's `AGENTS.md` derive from it, so changing it changes
  what every connected agent is told. An API-contract decision before it is a
  feature.

## Corrections to assumptions made along the way

- **There is no scrolling.** `SCROLL SPEED` in the display settings is the flap
  step rate, not marquee text; `layout.mjs` has no scroll or marquee. Long text
  becomes multiple *pages* shown in sequence.
- **`Settings` is still what eight documents call the Edit screen.** The button
  was renamed; GETTING-STARTED, QUEUES, SCREENS, BOARD-TYPES and others still
  say "Settings → Queue". A sweep is owed, minus GETTING-STARTED's references
  to *Claude's* settings.
