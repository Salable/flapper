# Board types — authoring guide

A board type packages a way of playing: what creating one asks for, what the
queue means, how items get in, and what the glass shows when. `live`,
`scheduled`, and `shared` are all built through the door this guide
describes, and so is the next type — **this document plus the contract
harness is the complete recipe**. It is written so an agent with no other
context can produce a type that loads.

## The shape of a type

A type is one server module and one registry line each side:

```
lib/board-types/<id>/definition.mjs      the definition (all behavior)
lib/board-types/index.mjs                add the import + one array entry
components/board-types/registry.ts       add { id, queueEditor } (null is fine)
```

Run `node --test tests/board-type-contract.test.mjs`. The harness iterates
every registered type and enforces everything below; a type that passes is
loadable. Nothing else to wire: the create modal, settings, the API, and the
per-board AGENTS.md all read the registry.

## The definition contract

```js
export default {
  id: 'countdown',            // [a-z][a-z0-9-]*; also the directory name
  name: 'Countdown',          // the create card's title
  tagline: '…',               // one line under it
  description: '…',           // the card's body; also quoted to agents
  capabilities: ['…'],        // the card's outcome list - what you get
                              // ("Plays as it arrives"), never the machinery
  sample: 'T-MINUS 10',       // a ≤12-tile line the card flips live
  recommended: false,         // true marks the default ("Start here")
  tier: undefined,            // name an account tier to lock the listing;
                              // enforced in createBoard (REST and MCP alike)

  configVersion: 1,
  migrateConfig(config, fromVersion) { return config; },

  createParams: [ /* param schema, below */ ],
  itemParams: [],             // reserved; validate item fields in ingest

  queuePolicy: {
    cap: (config) => 100,     // max items; the host enforces it
    onFull: 'reject',         // or 'roll' (oldest pending item drops)
    isPending: (item, { currentItemId }) => true,  // what "flush" removes
  },

  playback: 'live',           // or 'clock' — which player machine runs
  ingest(priority, entry, { snapshot, config, nowMs }) {
    return { entry, placement: 'append' };  // 'now' | 'next' | 'append'
  },

  // clock types only:
  validateConfig(config) {},                 // optional; throw reject(msg, 422)
  fallbackItem(config) { return null; },     // optional; the between-slots item
  itemAt(items, fallback, config, nowMs) {}, // required: the playback decision
  snapshotExtras(board, snapshot, nowMs) {}, // required: merged into GET /queue
};
```

### Params (`createParams`)

Each param renders in the generic create form and validates server-side:

```js
{ key, kind: 'text' | 'number' | 'select' | 'checkbox' | 'message',
  label, hint?, default?, required?,
  advanced?,                 // true: not asked at creation (the default
                             // applies); editable in Settings → General
  maxLength?,                // text/message
  min?, max?, integer?,      // number
  options? }                 // select: [{value, label}]
```

Creation asks for the minimum a type genuinely needs. Mark anything a
first-run user has no basis to choose (a queue depth, a tuning knob)
`advanced`; the create form skips it, the server applies the default, and
Settings → General renders it under "Type settings". `PATCH /config`
validates a patched param by this same schema.

`name` is conventionally the first param; the host lifts it out as the
board's display name and stores the rest as `board.config`. Bump
`configVersion` and handle the old shape in `migrateConfig` if a param's
meaning must change — never reuse a key with a new meaning at the same
version.

### The two playback machines

**`live`** — the display plays the queue in order and reports completions;
the server advances the head (epochs make that idempotent across mirrored
displays). Your `ingest` decides what `priority: now/next/normal` mean by
returning a placement. See `lib/board-types/live/definition.mjs`.

**`clock`** — nothing advances. Every display (and the server, for
`GET /queue`) calls your `itemAt(items, fallback, config, nowMs)` and shows
what it returns:

```js
{ item: <a queue item, or the fallback, or null>,   // null = dark glass
  isFallback: boolean,
  nextChangeAtMs: <ms timestamp or null> }           // when to re-evaluate
```

`itemAt` must be **pure and total**: same arguments, same answer, on any
input (including `[]` and a null fallback), no exceptions. That purity is
the whole synchronization story — screens agree because they compute the
same function of the same clock; there is nothing to coordinate.

### Clock authority

A type never reads `Date.now()` — time arrives as `nowMs`. On displays the
host passes the **server clock** (captured as an offset at each sync), so a
wall of screens with skewed local clocks still cuts slots together. If you
need scheduling arithmetic, use `lib/board/schedule.mjs` — its evaluator
already pins the hard rules:

- **Anchors**: `interval` anchors at the item's `createdAt`; `everyN` (and
  `hourly`) anchor at local midnight in the board's timezone, so ":15 past"
  survives DST.
- **Winner**: the active item with the latest trigger. A short overlay
  expiring hands the glass back to the longer item beneath it.
- **Ties** rotate by trigger count — deterministic on every screen.
- **DST** (Intl only, no tz libraries): a wall time erased by spring-forward
  fires at the transition instant; one repeated by fall-back fires at its
  first occurrence only.
- `durationMs: null` means "until the item's own next trigger";
  omitted means the computed read-through estimate (`computedDurationMs`,
  which the host maintains as a pure function of payload + config).

### Rules the harness enforces

- The definition is **server-safe and client-safe**: import only from
  `lib/` (pure modules — the display bundles your definition). Never
  `react`, never anything `'use client'`, never `lib/db/`.
- Server and client registries list **exactly the same ids**.
- `ingest` is total over `now`/`next`/`normal` and always returns
  `{entry, placement}`.
- Default `createParams` produce a valid config; junk input rejects 422.
- Clock types: `snapshotExtras` returns JSON-serializable data; `itemAt`
  is total on empty input.
- **Types add no server routes - guaranteed, not merely unsupported.**
  Everything a type does flows through these hooks, called from the generic
  handlers, with the type's config and items as arguments. This is the
  property that makes a catalogue possible: a type can be hosted without
  being trusted with the request, the session, or the database, so a
  third party's definition costs no more review than a data file. Do not
  add a hook that hands a type any of those.

### Failure containment

You do not have to be perfect to be safe. An unknown or throwing type
degrades that one board to the paused presentation ("BOARD PAUSED. SEE
SETTINGS"); the queue is kept and exportable. The app never goes down with
a type.

## Worked example: a countdown type

A board that counts down to a moment, then holds a message. Clock playback,
no schedule specs needed — the count *is* the schedule:

```js
// lib/board-types/countdown/definition.mjs
import { reject } from '../../api/errors.mjs';

const MINUTE = 60_000;

function render(config, nowMs) {
  const target = Date.parse(config.target);
  const left = target - nowMs;
  if (left <= 0) return { text: config.done || 'IT IS TIME', next: null };
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor(left / 3_600_000) % 24;
  const m = Math.ceil(left / MINUTE) % 60;
  return {
    text: `${config.label}\n${d}D ${h}H ${m}M`,
    next: nowMs + (left % MINUTE || MINUTE), // re-cut on the minute
  };
}

export default {
  id: 'countdown',
  name: 'Countdown',
  tagline: 'Days, hours, minutes — then the message.',
  description: 'The board counts down to a moment you set, then holds a message.',
  capabilities: ['clock'],
  configVersion: 1,
  migrateConfig(config) { return config; },
  createParams: [
    { key: 'name', kind: 'text', label: 'Board name', maxLength: 80, default: '' },
    { key: 'label', kind: 'text', label: 'Counting down to', maxLength: 40, required: true },
    { key: 'target', kind: 'text', label: 'Moment (ISO 8601)', required: true },
    { key: 'done', kind: 'message', label: 'When it arrives', maxLength: 400, default: '' },
  ],
  itemParams: [],
  validateConfig(config) {
    if (config.target !== undefined && !Number.isFinite(Date.parse(config.target))) {
      reject('target must be an ISO 8601 moment, e.g. 2026-12-31T23:59:00Z', 422);
    }
  },
  queuePolicy: { cap: () => 1, onFull: 'reject', isPending: () => true },
  playback: 'clock',
  // The countdown is synthesized from config; posted items are refused.
  ingest() {
    reject('a countdown board has no queue; change its config instead', 422);
  },
  itemAt(items, fallback, config, nowMs) {
    const { text, next } = render(config, nowMs);
    return {
      item: { id: '__countdown', updatedAt: nowMs, payload: { text, options: {} } },
      isFallback: false,
      nextChangeAtMs: next,
    };
  },
  snapshotExtras(board, snapshot, nowMs) {
    const { text, next } = render(board.config ?? {}, nowMs);
    return { showing: text, nextChangeAtMs: next };
  },
};
```

Register it (`index.mjs` import + array entry; `registry.ts` gets
`{ id: 'countdown', queueEditor: null }`), run the harness, create one from
the dashboard. That is the entire surface area.

> One honest caveat: `ingest` throwing means plain `POST /message` is a 422
> on this type — deliberate here, but the harness's totality test will flag
> it. A type that refuses ingestion should say so in its `description`, and
> the harness expectation should be updated alongside — which is the point:
> the harness is the contract's teeth, and loosening it is a reviewed change,
> not a silent one.

## What the host owns (so you don't)

Persistence, transactions, caps enforcement, the command stream, display
tokens, durations (`computedDurationMs`), expiry sweeps (`expiresAtMs` on
`once` schedule specs), pausing, export, and every route. A type is data
and pure functions; the host is the machine around them.
