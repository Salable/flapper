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
   * How far the wrong character sits from the right one, in ring steps.
   * 0 is the original behaviour: anywhere in the charset, so the correction
   * is a long journey. 1 is the neighbour - a tick over rather than a flip.
   */
  stepDistance: 0,
  /** How long the wrong character stays wrong, in ms. Read by ambient.ts. */
  holdMs: 900,
  /**
   * Travel speed for the correction only, in ms per step, or null to use
   * the board's own. A tile can only move forward, so coming back from a
   * one-step misfire means going all the way round; making just that
   * journey fast is what keeps a small gesture small.
   */
  returnStepMs: null,
});

/**
 * The styles that ship. A board picks one by id, beside its rate.
 * `classic` is the behaviour every existing board already has.
 */
export const FIDGET_STYLES = Object.freeze({
  classic: Object.freeze({ ...FIDGET_DEFAULTS }),
  /** One card ticks over to its neighbour and hurries back. Rare, quiet. */
  tick: Object.freeze({
    ...FIDGET_DEFAULTS,
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
 * @returns {{kind: 'rest'} | {kind: 'sweep'}
 *   | {kind: 'flicker', index: number, char: string,
 *      picks: Array<{index: number, char: string}>}}
 *   flicker: show those characters briefly, then restore.
 */
export function idleAction(text, charset, tick, style) {
  const { sweepEvery, restOdds, flickerCount, stepDistance } = { ...FIDGET_DEFAULTS, ...(style ?? {}) };

  if (sweepEvery > 0 && tick > 0 && tick % sweepEvery === 0) return { kind: 'sweep' };

  if (flickerCount < 1) return { kind: 'rest' };

  const letters = [...text]
    .map((char, index) => ({ char, index }))
    .filter(({ char }) => char !== ' ');
  if (letters.length === 0) return { kind: 'rest' };

  const roll = hash(tick);
  if (restOdds > 1 && roll % restOdds === 0) return { kind: 'rest' };

  const ring = [...charset];
  const picks = [];
  const taken = new Set();
  for (let n = 0; n < flickerCount; n += 1) {
    // n === 0 reproduces the original two hashes exactly, so a default style
    // yields byte-identical sequences to the version before styles existed.
    const salt = n * 2;
    const { char, index } = letters[hash(tick + 1 + salt) % letters.length];
    if (taken.has(index)) continue;

    let next = null;
    if (stepDistance > 0) {
      const at = ring.indexOf(char);
      if (at >= 0) {
        // A step can land on the blank, which reads as the card falling out
        // rather than ticking over; walk on until it is a real character.
        for (let step = stepDistance; step < stepDistance + ring.length; step += 1) {
          const candidate = ring[(at + step) % ring.length];
          if (candidate !== ' ' && candidate !== char) { next = candidate; break; }
        }
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
