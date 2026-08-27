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

**The source picker itself, as decided 27 Aug 2026.** A dropdown, three
choices, each with its own setup step, all inside one popup - Name at the
top, shared by every source, then the picker, then whichever setup step
applies:

| Pick | Setup step |
| --- | --- |
| Text | Edit text |
| API | Nothing extra - see below |
| Animation | Pick which one, from a dropdown |

**No separate slot name for API - the sheet's own Name is the address.**
Caught in the prototype: a first pass asked for a "slot name" on top of
the sheet's own Name (the rail's tab label, needed regardless of source) -
redundant, typing the same fact twice. A board can hold several API
sheets at once, each independently addressable, so a name is genuinely
needed - it is just the one every sheet already has, not a second field.
`POST /api/b/{slug}/sheets/{name}` derives live from Name as you type it,
shown in the prototype.

**Built for real, 27 Aug 2026 - the whole shape below, not just the
Align/Valign slice that shipped first.** Started as that smaller slice
(two `Select`s next to Hold, committing immediately like Hold already
does) with the popup and Source picker deliberately left for after -
turned out that undersold what was asked for. Rebuilt the same day into
the real thing: `components/SheetEditor.tsx` (new), the shared
`QueueItem`/`payloadToBody` shape pulled out to `components/
queue-item.ts` so both it and `QueueManager.tsx` draw from one
definition. `QueueManager`'s own inline Name/Text/Hold/Align/Valign
block is gone - along with the immediate-commit machinery that existed
only to serve it (`commitDraft`, `commitName`, `commitAlign`,
`commitValign`, the `draftText`/`nameDraft` state) - replaced by a
one-line preview and an "Edit sheet →" button. `ThemePreview` gained
`align`/`valign`/`wrap` props either way, threaded through to
`Flipboard.setText`'s own overrides, so every live preview (this one
included) actually shows what they do. One real bug caught before it
shipped: naively passing `{align, valign, wrap}` as overrides when
they're `undefined` would have overridden `layout()`'s own defaults to
`undefined` too (object spread copies an explicit `undefined`, it
doesn't skip it) - every other `ThemePreview` caller that never sets
these would have silently gone left/top/word instead of center/middle/
word. Fixed by only including defined keys.

**Revised same day: no outer Modal at all.** "This is NOTHIG like what we
just planned" - the popup-with-Save/Cancel above was still one layer too
indirect; Dan's ask was Name and Source sat directly in the panel, committing
immediately, the same way Hold already does. `SheetEditor` is now a plain
`<div>` (`.sheet-editor-row`: required Name `TextInput` + Source `Select`,
inline, no wrapping `<Modal>`, no Save/Cancel of its own) rendered straight
into the Board tab's `.queue-panel`, keyed on `selected.id` so switching
slides remounts it cleanly - replaced the `editorOpen`/`setEditorOpen` state
that used to gate the old "Edit sheet →" button entirely. `EditTextPopup`
itself is the one thing still a popup (see below, unchanged reasoning) -
just no longer nested inside a second one.

**Interruptions got the same depth, not a lighter version.** Asked
outright rather than assumed, after the under-scoping above: full
Align/Valign/Free-text grid for a saved interrupter's Text source, same as
a slide, not just Source picker + Name. `InterrupterPreset` gained
`rows`/`align`/`valign` fields; `validateInterrupterPreset`
(`lib/api/validators.mjs`) now accepts `rows` as an alternative to
`text`(+`align`+`valign`), mirroring the live-message `textOptions`
either-or exactly rather than inventing a new shape; `fireInterrupter`
(`lib/api/handlers.mjs`) builds its fire body either-or to match. Name +
Source sit inline in the preset form the same as a slide's; the preset's
own Save/Cancel stays batched though (a saved interrupter is deliberately
not a live edit - `EditTextPopup`'s `onSave` here only updates local draft
state, the real `POST /interrupters` happens on the form's own Save).
Covered in `tests/validators.test.mjs` and `tests/api.test.mjs`; verified
live end to end (name → align text → save → list → fire → correct content
on the glass).

**Text's own setup step is a popup modal, and it is a nested one** - not
folded into Edit sheet's own body. Edit sheet shows a one-line preview
plus an "Edit text →" button; that button opens a second, wider popup
with the actual grid editor, the same reasoning ComposeModal was its own
popup in the first place: a real text designer needs room a Name/
Source-sized dialog doesn't have. Not built on the shared `<Modal>`
component - two independent `Modal`s each bind their own window Escape
listener, and the outer's (registered first) would win a race against
the inner's, closing both at once instead of just the one just opened.
`EditTextPopup` reuses `.ui-modal*`'s own classes for identical chrome,
with its own capture-phase Escape handler that stops the event before it
reaches the outer modal's bubble-phase one. Sized to reflect the board's
actual grid (its real cols × rows at the card size and screen currently
chosen), same as ComposeModal's own textarea was "a fixed cols x rows
box, a dot for every cell nothing has reached" (see *Done on this
branch* above). The prototype had both modes rendering as the same tile
grid; the real build diverged from that in one place, deliberately:

- **Word break** - the default mode (renamed twice: "Just type", then
  "Alignment", settled on "Word break" since that's the one fact that
  actually distinguishes it from Free). **Reverted back to the tile grid
  after briefly not being one** - a first pass gave it a real `<textarea>`
  with a live `ThemePreview` beside it instead (real engine, real skin,
  so what's shown is what lands), reasoning that a per-character blinking
  cursor inside the real preview would mean teaching `Flipboard`/canvas a
  cursor-cell concept it's never needed. Shipped that way, without
  checking it against what was actually agreed - Dan caught it by looking
  at the running app ("this isnt what we worked on"), because the
  prototype's own deal was both modes render as the *same* tile grid,
  differing only in what's computed - not a decision that was ever
  reopened. See [[no-silent-overrides]] in memory. Reverted: types
  straight into the same `.sheet-grid-frame`/`.sheet-cell` grid Free
  uses, wrapped live via `layout()` itself (`lib/board/layout.mjs`,
  `wrap: 'word'`) against a small fixed charset - wrapping only needs to
  know a character is one cell wide, not the real theme's own manifest,
  so this doesn't need the skin loaded (loading that means loading its
  canvas art, exactly what the cursor-in-real-preview idea would have
  needed too). No mid-text caret - types at the end only, like a
  terminal, matching the "typing into a terminal type thing" framing this
  was asked for in the first place; Backspace/Enter/paste all act on that
  one flat buffer, which `layout()` re-wraps on every keystroke. **Caught
  a real bug in the process, not just a design mismatch**: `switchLayout`
  going Word break -> Free used to split the raw buffer on literal `\n`
  only and clip each "line" to `cols` characters - fine for a
  manually-broken textarea, silently truncated anything relying on
  word-wrap the moment the popup defaulted to this mode day to day, since
  now there usually isn't a literal `\n` in typed text at all. Found via
  screenshot (a 39-character typed string round-tripped through Free and
  back landed 20 characters) before it shipped, fixed by seeding Free
  from the already-wrapped page instead of the raw buffer. **A second real
  bug, caught the same way (screenshot, Dan looking at it live):** an
  accidental run of extra Enters at the end of a line, with nothing typed
  after them, silently pushed "centre" off centre - `layout()` counts every
  blank line toward vertical centring, so trailing blanks ate into the slack
  a real paragraph gap is supposed to use, and Backspace *did* remove them
  one at a time but nothing visible changed until enough were gone to shift
  a whole row - "i cant undo them," correctly, there was no way to see it
  working. Fixed at the popup level (not in `layout()` itself, which plenty
  else still relies on): trailing Enters with nothing after them are
  trimmed before preview and before save, so they're simply inert rather
  than needing to be found and undone - Enter typed *between* real text is
  untouched, still a real paragraph gap. Carries its
  own **Align** (left/center/right)
  and **Valign** (top/middle/bottom) dropdowns - the full three-way ×
  three-way pair, after a pass that tried to simplify it away to "always
  centred, one word-break toggle" turned out to be removing a real,
  wanted control, not just clutter. Hard line breaks already work at the
  layout-engine level regardless of wrap - `layout()` splits on `\n` into
  paragraphs before wrapping either one (`lib/board/layout.mjs`), so
  Enter always forces a new line; word break only reflows a line too
  long to fit.
- **Free** - a genuine tile grid (`.sheet-grid`/`.sheet-cell` in
  `app/board.css`, CSS tokens, not a canvas render of the actual skin -
  see the note above for why), one character per square, placed exactly
  where typed. What rows-mode composing (`options.rows`) already is at
  the API layer, just not offered as a typing experience until now. Has
  its own blinking cursor: the next square, not the field-focus ring
  (see "Focus indicator" below - two different facts, two different
  treatments). Enter jumps to the start of the next row.

Both are "Typed" in the table above; this is the UI shape for it, not a
new source. **One window, not two** - caught in the prototype: switching
between them used to swap in a second, independently-blank editing
surface, which read as "where did my text go". Fixed by carrying the
content across the switch instead - the grid's current content is
snapshotted into the other mode's own representation (aligned text joins
into rows and re-flows; free-text rows join with `\n` and get wrapped
fresh) rather than the switch ever starting from empty. Controls
themselves are plain dropdowns/checkboxes now, not a two-button
mode-switcher styled like a pair of tabs - the tab styling was itself
part of what made this read as "two different windows" rather than one
with a setting.

**Focus indicator, built.** Not the app's universal amber ring (`--ring`,
`:focus-visible` in `app/ui.css`) - a deliberate, scoped exception,
`--ring-quiet` in `app/design-tokens.css`. Amber is right everywhere else
(the fix for a real 2.17:1 contrast failure, WCAG wants 3:1) but reads as
a stamped orange box on a field you stare at while writing. A real bug
caught live, not just in the prototype: the first pass gave
`.sheet-grid-frame:focus` a quiet box-shadow but left `outline` alone,
so the universal `:focus-visible` amber ring - tied on specificity with
the bare `:focus` rule, and source order happened to favour amber - kept
showing through anyway. `outline: none` written inside the `:focus`
block itself (not just the bare selector) gives it strictly higher
specificity, which is the only way to reliably win regardless of which
stylesheet loads last. Caught by an actual screenshot showing the amber
ring still there after the "fix"; re-verified with another screenshot
after the real fix before calling it done.

**Card size changing after text exists is a real hazard, flagged
outright, not yet solved.** Free text especially - it has no layout to
re-flow, so a smaller grid after the fact can leave characters with
nowhere to land. Needs an answer (warn before applying, re-flow what can
be re-flowed and flag what can't, cap how small a size a board with free-
text sheets can go, or something else) before free text ships - not
picked yet.

**Animation is new** - not in the table above at all. A sheet whose content
is a designed or picked motion, not text. **Nothing to pick yet - no
animations exist.** The dropdown can exist before they do; it is just
always empty until "Movement" (see *Bigger, each its own branch*) or
something like it ships.

This is the real shape of *Then — sheets* below, not a separate ask -
supersedes the stale ComposeModal wrap-preview item under *Left by the code
review* (marked resolved there, cross-referenced back to here), and closes
the "no way to set a slide or interrupter to be an API thing" line under
*Raised by Dan* - it is this same source picker's second choice, not
separate work.

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
- [x] ThemePreview blanked (or garbled) on a resize while mounted, and
      changing card size back did not fix it - only a hard reload did.
      Found on the sign's own "what it says" preview, which is new enough
      to be the first caller that watches a board's cols/rows change while
      it stays on screen. Cause: `Flipboard.setGrid` reallocates the tile
      array by flat index into the new shape (deliberately - it's how a
      message keeps flipping through a resize instead of blanking
      outright) but nothing re-lays the text out for the shape it just
      became - the build effect only ever re-skins an existing board, and
      the "flip it in again" effect only fires when the text itself
      changes, so a plain grid resize called neither. The `[cols, rows]`
      effect now calls `setText` again (snapped, not flown in - a resize
      is a discontinuity) right after resizing.
- [x] Fidget did not seem to be enabled - true in the one place it was
      checked: the settings-page "what it says" preview never ran ambient
      motion, only the real display did, so watching a sign there while
      Fidget was set showed a board that never moved. (The mechanism
      itself was fine - confirmed by instrumenting BoardApp's own timer,
      which fired exactly on schedule.) `components/flapper/ambient.ts`
      pulls the ambient logic out of BoardApp into a shared `createAmbient
      (board)` that both it and ThemePreview now call, so a board fidgets
      the same way wherever it is watched - `ambientMs` threaded down
      Settings → QueueManager → ThemePreview.
- [x] Three small sidebar findings, fixed together: Edit and Remove on a
      sign's one item were never gated behind `isSign` the way reorder/loop
      already are - Remove in particular would empty the queue while the
      display, which holds its last message, kept showing it regardless,
      so the panel said blank when the wall did not. Both hidden now;
      Change it and Blank it are what a sign's one item can mean. "Live
      queue" and "active"/"paused" got an explanation, since neither is a
      term this build has defined anywhere a first-time reader would see
      it - as a native `title` first, then dropped in favour of a CSS
      tooltip (`Chip`'s new `tip` prop) once a real hover in a real
      browser did not show one at all. And Start from/Screen/Card size/
      Fidget apply themselves with no Save button and, until now, no
      confirmation either - went through three placements before landing:
      a page-top notice nobody watching the sidebar ever saw, then a badge
      beside the sidebar's own cards-count line that read as "saving works
      here, not when you change what the board actually says" the moment
      it was compared against composing - one shared "Saved" toast, fixed
      to a real corner of the viewport, that both `onConfig` (the sidebar)
      and a successful compose fire through the same `onSaved` callback
      from SettingsClient.
- [x] Asked outright whether a sign needs "Live queue" and "active" at
      all. Active - yes, real state for any board. "Live queue" - no, and
      worse than unnecessary: it names the mechanism (a queue) a sign
      explicitly turns off, the same way Priority/Hold/Loop already are.
      Now shows "Sign" instead, derived the same way `isSign` already is
      everywhere else (from `queueCap`, not the type id) - its own tip
      explaining Queue size is the lever, rather than the old tip trying
      to explain both a queue and a sign under one label.
- [x] The "What it says" box beside a sign's preview asked outright: "you
      see that thing - it's a slide label?" It was, and nothing else -
      the same text the preview already showed, plus Blank it. Given a
      whole surface of its own (`.sign-surface`, no second grid column)
      rather than a design-controls column with one line in it: the
      preview at full width, Change it and Blank it as one action row
      beneath. Queue mode's own two-column layout (design-surface)
      untouched - verified side by side on a sign and a cycle in the
      same run.
- [x] The left-nav tab holding Change it/Blank it still said "Queue" for
      a sign - same mistake as the chip, just missed there. "Board" now,
      derived from the same `cap === 1` SettingsClient already computes
      for QueueManager's own `cap` prop, not a second copy of the check.
- [x] /designs: reported as "narrow" with an "ugly overflow scroll", and
      pushed back on when the first pass called the scroll acceptable -
      rightly. `.dash`'s shared 920px cap leaving design-gallery's grid
      only two cards per row was real (see below), but the scrollbar
      turned out to be a real, root-level bug, not just an odd-looking
      div: `html, body { overflow: hidden }` was global, so every
      app-shell page - not only designs - has never been able to scroll
      itself; `.dash { overflow-y: auto }` existed purely as the
      workaround, a scrollbar that belongs to a centred, capped-width div
      rather than the browser's own edge. Only #stage (the wall display)
      actually needs the page frozen. Rescoped to `body:has(#stage)`,
      `.dash`'s own overflow removed, `.app-bar` made `position: sticky`
      so it still stays put on an ordinary scroll. Verified both ends:
      designs scrolls the real page now (body scrollHeight > viewport,
      app-bar pinned through it), and a board's display still reports
      `overflow: hidden` on body, untouched. `.dash.designs` at 1400px
      for the grid itself - four cards per row at 1600px, three at 1200,
      no overflow at either, correctly centred.

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

## A day/night ambient cycle

*Raised 26 Aug 2026, alongside the clock/pause question - both of those
turned out to already exist (Scheduled's `playback: 'clock'` timetable,
and board-level Pause & export). This is the one part of the ask that
doesn't: nothing today ties a design's appearance to the real time of day.

Same reasoning as "Board motion belongs to the design, not the board" -
this is a design property (an `advanced` field or its own pack section),
not a board setting, since it's about how a *look* behaves, not what a
particular board shows.

- [ ] Decide the mechanism: a formula over the clock (dim/warm at night,
      the way the tint's own drift already turns on a period) versus named
      presets versus something else - not designed yet, just named.

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
outright if sent. The table below is verified against the real function, not
just sketched - regenerated 26 Aug 2026 after `colsForCardSize` started
scaling cols with the screen's aspect ratio (see `lib/board/geometry.mjs`) so
that a size's total card count stays roughly constant across orientations
instead of ballooning in portrait; 16:9 is unchanged since it is what the
five sizes are calibrated against, every other shape's numbers below are not
what a flat cols-for-size lookup would have given:

| Card size | 16:9 | 4:3 | 9:16 | Square |
| --- | --- | --- | --- | --- |
| Huge | 8 × 5 | 7 × 5 | 5 × 9 | 6 × 6 |
| Large | 12 × 7 | 11 × 8 | 7 × 12 | 9 × 9 |
| Medium | 20 × 11 | 17 × 13 | 11 × 20 | 15 × 15 |
| Small | 32 × 18 | 28 × 21 | 18 × 32 | 24 × 24 |
| Tiny | 48 × 27 | 42 × 32 | 27 × 40 | 36 × 36 |

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

## The card itself, not just the flip

Raised directly: a resting tile read as one flat plastic rectangle rather than
two hinged vanes, and the whole board looked too clean to have hung anywhere.

- [x] `hinge.highlight` (a vane's bevel, already coded and drawable) and
      real pin sizes now have actual defaults instead of `null` /
      too-small-to-see - Classic and any pack that never touched `hinge` were
      the only ones this changed; the four packs that already set their own
      `highlight` were untouched. Positioned on the *lower* vane's top edge -
      it was drawn on the upper vane at first, which turned out to be the
      actual cause of a hinge that measured dead centre but read as sitting
      high, fixed once caught and described where that fix landed.
- [x] `card.vignette` and `card.grunge`, two new pack fields (defaults 0.22
      and 0.14) - light falling off toward the card's edge, and a scatter of
      dark specks plus a couple of soft pooled smudges. Baked into `paintCard`
      once per state, so it costs nothing at draw time and rides along on
      both flap halves automatically.
- [x] A soft shadow bleeding from a mid-flip tile into the gap below it, not
      just the shading it already threw onto its own lower half - peaks with
      the flap flat-on, same curve as the existing in-card shadow.
- [ ] **Grunge is baked per state, not per grid position** - every tile
      currently showing the same letter shares the exact same speckle
      placement, since it draws from the one cached card for that state. A
      real board's wear is per physical tile. Fixable (a shared noise texture
      sampled by grid position instead, applied per frame in `drawTile`
      rather than baked in `paintCard`) but costs a draw call per tile per
      frame instead of nothing - not done since the baked version already
      reads as worn at the strength shipped.
- [x] `advanced.frameMs` (default 70): the canvas now repaints at most this
      often, not every rAF tick - a lower visual frame rate reads as a flap
      actually clacking through positions rather than a 60fps blur. The step
      timing that drives sound and idle detection is untouched; only how
      often the canvas is repainted changes. Live-measured via CDP: a
      steady ~75ms gap between repaints during a flip, against a 70ms
      target (the difference is rAF's own ~16.7ms granularity - a throttled
      gap always lands on a multiple of that, not the raw number typed in).
- [x] `lib/api/mcp.mjs`'s `update_config` schema no longer advertises `cols`,
      `rows`, `dwellMs` or `staggerMode` as board-level fields - all four
      have been refused by `validators.mjs` since they moved to `screen`/
      `cardSize`/the design's pack, and the schema had drifted out of sync
      with both moves. `themePack`'s own description now says `advanced`
      is a section too, since it never did. `get_capabilities` → `themePack`
      was already correct (it derives from `RANGES`, not a hand list), so
      `frameMs`'s range needed no separate change there.
- [x] `update_config` can set `screen` and `cardSize` now, both `null`-
      resettable like the REST API always allowed (`z.union([z.null(), ...])`
      - an `enum` alone would have refused the reset). Found in the same
      pass: the cols/rows rejection message told a caller to send
      `screen: { w, h, diagonalIn }` - `diagonalIn` was never a real field,
      only ever tested as refused; fixed the message too.

## A real bug, found but not yet fixed: a black band mid-flip

Not this session's work - confirmed pre-existing by bisecting every change
made here today, one at a time, and it survives all of them.

**What**: during a flip, a thin fully-black (`rgb(0,0,0)`) horizontal band
sometimes appears inside the card face, well away from the hinge and the
outer edge - not a corner-clip leak (already fixed, verified separately),
not a rendering illusion. Confirmed with raw `ctx.getImageData` reads
against the live canvas, not screenshots - screenshots were the first clue
but PNG re-encoding was ruled out as the explanation before treating this
as real.

**How to reproduce**: a design at "Cards across" = 1 (one huge card), click
Flip again, sample the canvas repeatedly through the animation (every
~60-90ms) reading a column of pixels between roughly y=30-130 (tile-local,
i.e. canvas y=36-136 after the 6px padding) for a run of 5+ pixels reading
below `rgb(5,5,5)`. Reproduces under both rapid double-click (forcing a
full 42-state ring wrap) and, more importantly, **ordinary single clicks
one at a time** - roughly 1 in 5 samples across six separate single-flip
rounds in the last test run. This is common enough to matter, not a rare
edge case.

**Ruled out, each tested in isolation by PATCHing a design's pack via the
API and re-sampling** (not guessed): `card.grunge`, `card.vignette`,
`card.sheen` (all zeroed); `motion.shading`, `motion.shadow`,
`motion.highlight` (all zeroed); `hinge.thickness`/`hinge.highlight`
(thinned/disabled); `card.radius` (zeroed, making the clip a plain
rectangle); `advanced.frameMs` (zeroed, uncapped rendering). The band
survived every one of these, independently.

**The clip specifically** has been ruled out three times now, against
three different structures it has actually had, not just once against
whichever one existed when this entry was first written - worth being
explicit about, since the clip was rebuilt twice more after that first
test and the earlier version of this note didn't say which structure the
"removed it, still happened" test actually covered:

1. First test: the clip as of `5f77bac` - one `ctx.clip()` wrapping the
   *whole* tile (both static halves, the flap overlay, and the hinge/pins)
   at the card's full outer radius. Removed entirely by editing the code;
   band still reproduced.
2. `6706063` narrowed that to the in-flight lighting only, at the card's
   *inset* face rather than its outer edge - not re-tested at the time.
3. Re-tested now, after `drawTile` was restructured again (this pass) so
   the clip covers only the two lighting fillRects and never the
   `drawImage` calls (static or flap) at all: reproduced again, 11/48
   samples (~23%) across six single-click rounds - same rate as the
   original test, same reproduction steps below.

Since every change from today's card-look and flap-lighting work, across
every structural revision of the clip, is now ruled out, the cause is
somewhere in what was already there before this session - most likely the
static-halves compositing or the glyph/font rendering in `paintCard`,
neither of which got a comparably thorough isolation pass.

**Not done**: root cause. This is logged in enough detail to pick back up
without repeating the bisection - the next step that hasn't been tried is
isolating the static-halves `drawImage` pair and the glyph `fillText` call
in `paintCard` the same way the rest were ruled out, probably by rendering
a single state directly to an offscreen canvas outside `drawTile`
entirely and comparing it pixel-for-pixel against the same state sampled
mid-animation.

## From the multi-pronged review of the flip-mechanism rebuild

Found by a 7-lens parallel review (canvas geometry, pack schema, React/UI,
test coverage, consistency drift, performance, docs accuracy) with every
finding independently adversarially verified before anything below was
acted on. 16 of 18 confirmed findings were fixed directly (the clip
wrapping the flap's own `drawImage` too, `shade()`'s dead `dark` param,
`Math.sin(theta)` recomputed four times over, `background`'s missing test
coverage and MCP schema mention, `basedOnName` leaking a raw id when its
source design was deleted, and the stale docs above); the two below were
deliberately left rather than fixed blind.

- [ ] **The face-clip added to `drawTile` is a real per-frame cost, not a
      false alarm** - an extra `ctx.save()`/`roundedRect()`/`ctx.clip()`
      pair now runs for every in-flight tile, every repaint, where none
      ran before this session's card-look work. Not fixed: it's the direct
      cost of the correctness fix it exists for (lighting staying inside
      the card's edge rather than washing over it) - removing the clip
      means reintroducing the bug it fixes, not a free win.
- [ ] **That clip path is rebuilt from scratch every frame though it's
      identical for every tile at a given size** - `roundedRect()`'s
      `beginPath()`+`arcTo()`/`roundRect()` calls could be built once (a
      cached `Path2D`, alongside the per-state cards `prepare()` already
      caches) and reused via `ctx.clip(path)` instead. Not done: real
      complexity for a low-severity finding - three separate cached paths
      would be needed (the full inset face for the under-flap shade, plus
      two asymmetric three-sided rects for the flap's own highlight, one
      per half), each has to stay in sync with `prepare()`'s own resize
      handling, and `Path2D` needs the same feature-detection care every
      other optional canvas API in this file already gets. Worth doing if
      the plain per-frame cost above turns out to matter in practice on
      real wall hardware; not worth the risk blind.

## Left by the code review

- [x] **`lib/board/face.mjs` had no production caller** — deleted, with its
      test and the CSS-tile design plumbing. The dashboard's cards were the
      candidate caller and they draw on a canvas instead, which shows a design's
      behaviour as well as its colours. The canvas won on every surface, so a
      CSS tile in a design has nowhere left to be wanted.
- [x] ~~ComposeModal's "By character" wrap doesn't preview as
      character-wrap~~ — moot: ComposeModal doesn't exist any more (checked
      27 Aug 2026, superseded by the current tri-tab rework's plain Text
      panel), and along with it, Align/Vertical/Wrap have no UI anywhere
      today - a bigger gap than a wrong preview. Real shape of the fix is
      now "The source picker itself" under *A sheet has a source* above.
- [ ] **`.ui-chip-tip::after`'s flyout has no viewport-edge handling** —
      `left: 0; width: max-content; max-width: 260px`, unclipped. A tip opened
      near a narrow-viewport edge could push a few pixels of horizontal
      scroll rather than being invisibly clipped as it was before dash pages
      could scroll at all. Not reproduced live; speculative.

## Raised by Dan, 26 Aug 2026 — not yet scoped

Six things flagged in one pass, not yet investigated or broken down. Logged
in his own words; each needs its own look before it becomes real work.

- [ ] **The text editor has fallen out of shape.** Not yet diagnosed - which
      editor (compose, a design's own text field, something else) and what
      "fallen out" means visually is still to be pinned down.
- [ ] **The designer view uses clunky language.** A copy pass on
      DesignEditor/DesignGallery's own wording - which strings, not yet
      specified.
- [ ] **The docs are probably a mess.** Broader than today's targeted
      BOARD-API/QUEUES/SCREENS/agents-doc fixes (see the review section
      above) - a real full-doc audit, not yet scoped.
- [x] **No way to set a slide or interrupter to be an API thing** - given
      real shape 27 Aug 2026 under "The source picker itself" (*A sheet has
      a source* above): the picker's second choice, "API", same gap the
      sheets rework already named as "Pushed". Not built - scoped now,
      folded into the same work as the sheets rework rather than tracked
      separately.
- [ ] **No transition animations.** See *Transitions and washes* above -
      procedural washes as transitions are designed but not built.
- [ ] **No fidget animations.** Flagged directly at odds with this file's
      own "done" (`config.ambientMs`, wired end to end - see "The model, as
      decided" above, and BoardSidebar's own Fidget field). Needs a live
      check before assuming either: could be a real regression (fidget
      stopped actually firing somewhere) or could mean something beyond
      the twitch/sweep that exists today - the open "Types of Fidget, not
      just a rate" question above is exactly that second reading. Not
      assumed either way; check first.

## Found today, not fixed: Scheduled has no board preview at all

*26 Aug 2026, incidental to the letterbox/screenAspect work below.* Asked to
account for everywhere a board is shown, so every `ThemePreview` and
`Flipboard` call site got checked. Everywhere else - the real wall display,
Settings, Board tab, Interruptions tab, dashboard cards - has one. The
schedule-type board's own editor (`components/board-types/scheduled/
ScheduleEditor.tsx`, and `components/board-types/shared/SharedQueueEditor.tsx`)
does not: no `ThemePreview`, no `Flipboard`, nothing. Editing a schedule has
no visual feedback of what the board will actually show, on any screen or
card size.

Not part of the letterbox fix and not touched by it - a real, separate gap,
just found while auditing the same ground.

- [x] Give Scheduled's own editor a `ThemePreview`, screen-aware
      (`screenAspect`) like the rest, showing whichever slot is selected/
      current. The type-editor contract carried only `slug`, so it grew the
      same five board-look props SettingsClient already hands QueueManager
      (`BoardTypeEditorProps`); Shared forwards them through. A row in the
      schedule is now the control that picks what the preview shows -
      pinned slot, else what you are typing, else what is on the glass (the
      active slot, or the fallback). `.queue-list` had no CSS at all until
      now, which is why it never looked pickable.

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
5. **Types of Fidget, not just a rate.** Today "Fidget" is one knob - off, or
   every N seconds - and idle.mjs picks what happens each tick with no say
   from the board: flicker odds, how far a sweep travels, whether a sweep
   happens at all. A named style or two (say, a twitchier one for a busy
   space, a sweep-only one for something meant to be watched) plus the
   existing interval as intensity, rather than the interval alone standing
   in for both "how often" and "how much".

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
