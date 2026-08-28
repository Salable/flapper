/**
 * The wordmark's own idle animation.
 *
 * Not the board's - a board's is `fidgets.mjs`, which is a different model
 * for a different thing. This one belongs to the FLAPPER wordmark in the
 * header: a small self-animating board with no message, no design behind it
 * and nobody driving it, whose whole job is to look alive.
 *
 * They were briefly the same code. The first attempt at board fidgets grew
 * out of this file, and it ended up carrying eleven fields so that a board
 * could say what kind of fidget it wanted. That model is gone; a board's
 * fidget is now four numbers and a list of beats, and this went back to what
 * it always was.
 *
 * Pure - a deterministic function of the tick counter - so the sequence is
 * testable and every render of the same tick agrees.
 *
 * The rhythm imitates a real installation at rest: mostly stillness, the
 * occasional single tile misfiring to a wrong character and correcting
 * itself (a full revolution back), and now and then the whole board taking
 * one sweep around. Restraint is the design: at the default interval a sweep
 * happens about once a minute.
 */

/** Deterministic 32-bit scramble - the only randomness ambient motion gets. */
function hash(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** Every SWEEP_EVERY-th tick is a whole-board revolution; the rest flicker. */
const SWEEP_EVERY = 12;
/** Roughly half the non-sweep ticks rest entirely - stillness is part of it. */
const REST_ODDS = 2;

/**
 * What the wordmark should do at ambient tick `tick`.
 *
 * @param {string} text the standing text (spaces never flicker - the
 *   wordmark is a word, and a character surfacing beside it would read as a
 *   typo rather than as wear)
 * @param {Iterable<string>} charset characters a tile can show - the Set
 *   `charsetFromManifest` returns, or any array of them
 * @param {number} tick 0, 1, 2, … - the caller's interval counter
 * @returns {{kind: 'rest'} | {kind: 'sweep'}
 *   | {kind: 'flicker', index: number, char: string}}
 *   flicker: show `char` at `index` briefly, then restore - the correction
 *   flips the tile all the way around, which is the charm.
 */
export function idleAction(text, charset, tick) {
  if (tick > 0 && tick % SWEEP_EVERY === 0) return { kind: 'sweep' };

  const letters = [...text]
    .map((char, index) => ({ char, index }))
    .filter(({ char }) => char !== ' ');
  if (letters.length === 0) return { kind: 'rest' };

  const roll = hash(tick);
  if (roll % REST_ODDS === 0) return { kind: 'rest' };

  const { char, index } = letters[hash(tick + 1) % letters.length];
  // Flipboard hands over the ring's Set; tests hand arrays. Either is fine.
  const pool = [...charset].filter((c) => c !== char && c !== ' ');
  if (pool.length === 0) return { kind: 'rest' };
  return { kind: 'flicker', index, char: pool[hash(tick + 2) % pool.length] };
}

/** `text` with the flickered character dropped in - what the wordmark shows. */
export function withFlicker(text, action) {
  if (action.kind !== 'flicker') return text;
  const chars = [...text];
  chars[action.index] = action.char;
  return chars.join('');
}
