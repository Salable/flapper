/**
 * The ambient animation for a self-animating board (the wordmark), and the
 * fidget a real board does while it holds a message: what the tiles do when
 * nobody is driving them. Pure - a deterministic function of the tick
 * counter - so the sequence is testable and every render of the same tick
 * agrees.
 *
 * The rhythm imitates a real installation at rest: mostly stillness, the
 * occasional single tile misfiring to a wrong character and correcting
 * itself, and now and then the whole board taking one sweep around.
 * Restraint is the design.
 *
 * The *character* of that rhythm used to be three constants in this file and
 * one in ambient.ts, which meant a board could say how often it fidgeted and
 * never what kind. They are a style object now - data, the same move a design
 * made - and the defaults below are exactly the old constants, so a board
 * that names no style behaves as it always did.
 */

import { rampFlight } from './tint.mjs';
import { RING } from './ring.mjs';

/** Deterministic 32-bit scramble - the only randomness ambient motion gets. */
function hash(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * A fidget style. Five numbers and nothing else - the whole shape of "what
 * kind", as against `ambientMs`'s "how often".
 */
/* Not exported: it is the shape FIDGET_STYLES is built from and the fallback
   idleAction merges over, both in this file. A style reaches a caller as a
   FIDGET_STYLES entry via fidgetStyle(), never as the bare defaults. */
const FIDGET_DEFAULTS = Object.freeze({
  /** Every Nth tick is a whole-board revolution. 0 = never sweep. */
  sweepEvery: 12,
  /** About one tick in `restOdds` does something; the rest rest. 1 = always. */
  restOdds: 2,
  /** How many tiles misfire at once. 0 = never flicker (sweeps only). */
  flickerCount: 1,
  /**
   * How far the wrong character may sit from the right one, in ring steps -
   * a radius, not an exact distance.
   *
   * 0 is the original behaviour: anywhere in the charset, so the correction
   * is a long journey. Any other value picks at random from everything
   * within that many steps either way - the cheat that lets a cheap gesture
   * look like an arbitrary one, since the pool is only ever a few wide.
   *
   * A note on how little that should be used. At a radius of one, a blank
   * card can only tick to A or to `)`, and since most of a real board is
   * blank, A is most of what you ever see. That looks like a bug and is not
   * one: **the point of a tick is that it is one**. A card moves a single
   * position and comes back, and on a mostly-blank board that mostly means
   * A, exactly as a real board would. Widening the radius to fix the
   * repetition is fixing the wrong thing - it buys variety by spending the
   * gesture. Reach for a radius when a style wants a small *arbitrary*
   * jump; leave it at one when the style is the tick itself.
   */
  stepDistance: 0,
  /** How long the wrong character stays wrong, in ms. Read by ambient.ts. */
  holdMs: 900,
  /**
   * Travel speed for the whole gesture, in ms per step, or null for the
   * board's own.
   *
   * A colour style needs this and a plain one does not. Flight only shows
   * while a card is moving, so the time a colour is on screen is exactly
   * (steps there + steps back) x this. At one step each way and the board's
   * default 55ms, that is about eighty milliseconds - which is why the
   * first pina colada was, in Dan's words, too fast to really notice. The
   * drink is the point of that style, so it is allowed to take its time.
   */
  stepMs: null,
  /**
   * Travel speed for the correction only, in ms per step, or null to use
   * `stepMs`, or the board's own. A tile can only move forward, so coming back from a
   * one-step misfire means going all the way round; making just that
   * journey fast is what keeps a small gesture small.
   */
  returnStepMs: null,
  /**
   * Colours the misfiring tile passes through while it moves, or null for
   * whatever the design already flies.
   *
   * The board has had this all along - `flight` is a pack property, a colour
   * per ring step applied only in flight, and `flipboard.js` reads
   * `opts.flight` ahead of the skin's. So a fidget can borrow a palette for
   * the length of its gesture and hand it straight back: a card that flips
   * a little rainbow and settles into the design's own paint again.
   *
   * Same shape as a pack's `flight`: an array of #rgb/#rrggbb or null, no
   * longer than the ring.
   */
  flight: null,
  /** How strongly `flight` shows, 0-1. Ignored when flight is null. */
  flightStrength: 1,
  /**
   * How the flight colour meets the card: 'overlay' tints it and leaves the
   * letter readable, 'source-over' paints the colour over the top, letter
   * and all. null leaves the board on its own (which is 'overlay').
   *
   * A tint is right for a pattern glimpsed mid-journey. It is wrong when the
   * colour is the entire style - on a dark design an overlay takes its
   * brightness from a near-black card, so a pastel arrives grey.
   */
  flightMode: null,
  /**
   * Whether the card may turn back instead of finishing the lap.
   *
   * Off is the real mechanism: a split-flap only falls forward, so a card
   * that ticks one step over needs forty-one more to get home. That is fine
   * for classic, whose long journey home is the charm, and fatal for a small
   * gesture. On, the trip out and the trip back are the same few flips.
   *
   * Borrowed for the length of the gesture like flight is - the board goes
   * back to falling forward the moment the fidget lands.
   */
  shortestPath: false,
  /**
   * The name of a traveller (see travellers.mjs), or null for a misfire.
   *
   * The two are different animals - a misfire is one card briefly wrong, a
   * traveller is a creature that walks the board over many frames - but they
   * are the same *choice*, so they live in one list and a board picks either
   * the same way. When this is set the misfire dials above are unused.
   */
  traveller: null,
});

/**
 * The styles that ship. A board picks one by id, beside its rate.
 * `classic` is the behaviour every existing board already has.
 */
export const FIDGET_STYLES = Object.freeze({
  classic: Object.freeze({ ...FIDGET_DEFAULTS }),
  /**
   * One card ticks over to its neighbour and hurries back. Rare, quiet, and
   * anywhere on the grid - a blank tile is as likely to do it as a letter.
   */
  tick: Object.freeze({
    ...FIDGET_DEFAULTS,
    shortestPath: true,
    sweepEvery: 0,
    restOdds: 4,
    stepDistance: 1,
    holdMs: 700,
    returnStepMs: 25,
  }),
  /** Busy: several tiles at once, often, and a sweep now and then. */
  twitchy: Object.freeze({
    ...FIDGET_DEFAULTS,
    sweepEvery: 20,
    restOdds: 1,
    flickerCount: 3,
    holdMs: 500,
  }),
  /** Nothing but the whole board turning over. For something being watched. */
  sweeping: Object.freeze({
    ...FIDGET_DEFAULTS,
    sweepEvery: 1,
    flickerCount: 0,
  }),
  /**
   * Dan's rainbow: the card flies a full spectrum on its way over and back.
   * Anywhere on the grid, so the colour can surface out of empty space.
   */
  rainbow: Object.freeze({
    ...FIDGET_DEFAULTS,
    shortestPath: true,
    sweepEvery: 0,
    restOdds: 2,
    // Three steps at 110ms each way: two thirds of a second of colour,
    // against the eighty milliseconds one step at the board's pace gave.
    // Not a tick - tick is one step and has no colour. This is the flight.
    stepDistance: 3,
    stepMs: 110,
    holdMs: 260,
    returnStepMs: 110,
    flight: Object.freeze(['#e0503f', '#e08b3f', '#d8b25a', '#5fae5a', '#4a90d9', '#8b6bc4']),
    flightStrength: 0.9,
  }),
  /**
   * Pina colada: pineapple, coconut and a slice of lime. A card ticks over
   * and flies the drink on its way there and back.
   *
   * The naming is the point as much as the palette - a fidget is a mini
   * flight, so a style is really a colour with a rhythm, and colours are
   * easier to choose between when they are called something.
   */
  'pina-colada': Object.freeze({
    ...FIDGET_DEFAULTS,
    shortestPath: true,
    sweepEvery: 0,
    restOdds: 2,
    /*
     * Three colours back to back, and nothing else: the card turns solid
     * pineapple, then coconut, then lime, and comes back. Three steps
     * against a three-colour list means one stop per step whatever the card
     * started on - see the note on the list below.
     *
     * source-over rather than a tint, because the colour is the whole style
     * and an overlay on a near-black card returns it as grey. It covers the
     * letter, which is the point: this one is colour, not text.
     *
     * And slow. 340ms a step is about a second out and a second back, which
     * is a long time for a board that otherwise moves in 55ms - deliberately.
     */
    stepDistance: 3,
    stepMs: 340,
    flickerCount: 1,
    holdMs: 420,
    returnStepMs: 340,
    flightMode: 'source-over',
    /*
     * Exactly three, to match the three steps - flightColour indexes by ring
     * state, so a three-long list advances one stop per step and the card
     * shows each colour once, in order, wherever on the ring it began.
     *
     * This is why it does not ramp across the ring the way snake and sherbet
     * do, which looks like an inconsistency and is the opposite. A ramp over
     * forty-two would give three *neighbouring* shades of one colour for a
     * three-step trip. Ramp for a long journey or one spread over many
     * cards; match the list to the steps for a short deliberate one.
     */
    flight: Object.freeze(['#f2d16b', '#f7f0e0', '#7fbf5f']),
    flightStrength: 1,
  }),
  /**
   * A character surfacing somewhere in the empty space and going again -
   * the same "anywhere" as tick, but jumping the whole set rather than
   * stepping, so it reads as a card caught out rather than a small twitch.
   */
  scatter: Object.freeze({
    ...FIDGET_DEFAULTS,
    sweepEvery: 0,
    restOdds: 3,
    holdMs: 1000,
  }),
  /**
   * Sherbet: colour only. Five or six flips and no readable change.
   *
   * The trick is `holdMs`. Every other misfire lands on its wrong character
   * and *sits* there long enough to be read - that pause is the joke. Take
   * the pause away and the card never settles: it sets off, the restore
   * catches it mid-journey, and it turns straight round from wherever it
   * got to. What you see is the flight palette going past on a card that
   * ends up showing exactly what it showed before.
   *
   * Three steps out and three back at 25ms a step, so about a sixth of a
   * second of pastel and nothing else.
   */
  sherbet: Object.freeze({
    ...FIDGET_DEFAULTS,
    shortestPath: true,
    sweepEvery: 0,
    restOdds: 2,
    stepDistance: 3,
    holdMs: 60,
    returnStepMs: 25,
    flight: Object.freeze(
      rampFlight(['#f7b8c4', '#fbd3a8', '#f9edb0', '#bfe3c0', '#b6d9ee', '#cfc0e6'], RING.length),
    ),
    flightStrength: 0.95,
  }),
  /**
   * A snake does a lap of the edge, the way the game does - three greens
   * ramped across the whole ring rather than a couple of stops, so the body
   * reads as a gradient. Two greens over 42 states would strobe on alternate
   * steps; see rampFlight's own note.
   */
  snake: Object.freeze({
    ...FIDGET_DEFAULTS,
    shortestPath: true,
    traveller: 'snake',
    flight: Object.freeze(rampFlight(['#1f5c2a', '#4f9e4a', '#9fd98a'], RING.length)),
    flightStrength: 0.9,
  }),
  /** Pac-man round the edge with three ghosts strung out behind him. */
  'pac-man': Object.freeze({
    ...FIDGET_DEFAULTS,
    shortestPath: true,
    traveller: 'pac-man',
    flight: Object.freeze(['#d8b25a', '#e0503f', '#4a90d9', '#e08b3f']),
    flightStrength: 0.85,
  }),
  /** Almost never, and gently, for a wall in a quiet room. */
  calm: Object.freeze({
    ...FIDGET_DEFAULTS,
    sweepEvery: 0,
    restOdds: 8,
    holdMs: 1400,
  }),
});

/** A style by id, merged over the defaults. Unknown ids fall back to classic. */
export function fidgetStyle(id) {
  if (id && Object.prototype.hasOwnProperty.call(FIDGET_STYLES, id)) return FIDGET_STYLES[id];
  return FIDGET_STYLES.classic;
}

/**
 * What the board should do at ambient tick `tick`.
 *
 * @param {string} text the standing text (spaces never flicker)
 * @param {Iterable<string>} charset characters a tile can show, in ring order
 * @param {number} tick 0, 1, 2, … - the caller's interval counter
 * @param {object} [style] a FIDGET_STYLES entry; omitted, the old constants
 * @returns {{kind: 'rest'} | {kind: 'sweep'} | {kind: 'travel', traveller: string}
 *   | {kind: 'flicker', index: number, char: string,
 *      picks: Array<{index: number, char: string}>}}
 *   flicker: show those characters briefly, then restore.
 */
export function idleAction(text, charset, tick, style) {
  const merged = { ...FIDGET_DEFAULTS, ...(style ?? {}) };
  const { sweepEvery, restOdds, flickerCount, stepDistance } = merged;

  /*
   * A traveller ignores every dial above. Its rhythm is the ambient interval
   * (when it sets off) and its own stepMs (how fast it walks); rest odds and
   * sweeps would only fight that. The caller drives it - see travellers.mjs.
   */
  if (merged.traveller !== null) return { kind: 'travel', traveller: merged.traveller };

  if (sweepEvery > 0 && tick > 0 && tick % sweepEvery === 0) return { kind: 'sweep' };

  if (flickerCount < 1) return { kind: 'rest' };

  /*
   * Every card on the grid, blanks included - a fidget lands on any of them.
   *
   * It used to skip spaces, which quietly made a fidget a property of the
   * *words* rather than of the board. It is the board's: a blank flap is a
   * physical card like any other, and a character surfacing for a moment in
   * empty space is the most split-flap thing the thing does. This is a rule
   * rather than a style setting, so no style can put it back.
   *
   * A board with nothing on it at all is still left alone - ambient.ts
   * refuses to run on a blank page before it ever gets here.
   */
  const cards = [...text].map((char, index) => ({ char, index }));
  if (cards.length === 0) return { kind: 'rest' };

  const roll = hash(tick);
  if (restOdds > 1 && roll % restOdds === 0) return { kind: 'rest' };

  const ring = [...charset];
  const picks = [];
  const taken = new Set();
  for (let n = 0; n < flickerCount; n += 1) {
    // n === 0 reproduces the original two hashes exactly, so a default style
    // yields byte-identical sequences to the version before styles existed.
    const salt = n * 2;
    const { char, index } = cards[hash(tick + 1 + salt) % cards.length];
    if (taken.has(index)) continue;

    let next = null;
    if (stepDistance > 0) {
      const at = ring.indexOf(char);
      if (at >= 0) {
        // Everything within the radius, both ways round. The blank is never
        // a target - a card going blank reads as falling out of the board
        // rather than ticking over.
        const near = [];
        for (let step = 1; step <= stepDistance; step += 1) {
          for (const way of [1, -1]) {
            const candidate = ring[(at + way * step + ring.length * 2) % ring.length];
            if (candidate !== ' ' && candidate !== char && !near.includes(candidate)) {
              near.push(candidate);
            }
          }
        }
        if (near.length > 0) next = near[hash(tick + 3 + salt) % near.length];
      }
    }
    if (next === null) {
      const pool = ring.filter((c) => c !== char && c !== ' ');
      if (pool.length === 0) continue;
      next = pool[hash(tick + 2 + salt) % pool.length];
    }
    taken.add(index);
    picks.push({ index, char: next });
  }
  if (picks.length === 0) return { kind: 'rest' };

  // index/char stay for the single-tile case every existing caller reads.
  return { kind: 'flicker', index: picks[0].index, char: picks[0].char, picks };
}

/** `text` with the flickered characters dropped in - what the board shows. */
export function withFlicker(text, action) {
  if (action.kind !== 'flicker') return text;
  const chars = [...text];
  for (const { index, char } of action.picks ?? [{ index: action.index, char: action.char }]) {
    chars[index] = char;
  }
  return chars.join('');
}
