import test from 'node:test';
import assert from 'node:assert/strict';
import { idleAction, withFlicker, fidgetStyle, FIDGET_STYLES } from '../lib/board/idle.mjs';

/** The wordmark's ambient choreography: deterministic, restrained, total. */

const CHARSET = [...' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];

test('the sequence is deterministic and total over any tick', () => {
  for (let tick = 0; tick <= 200; tick += 1) {
    const a = idleAction('FLAPPER', CHARSET, tick);
    const b = idleAction('FLAPPER', CHARSET, tick);
    assert.deepEqual(a, b, `tick ${tick} must be stable`);
    assert.ok(['rest', 'sweep', 'flicker'].includes(a.kind));
    if (a.kind === 'flicker') {
      assert.ok(a.index >= 0 && a.index < 'FLAPPER'.length);
      assert.notEqual(a.char, 'FLAPPER'[a.index], 'a flicker must change the tile');
      assert.notEqual(a.char, ' ');
    }
  }
});

test('sweeps are rare and rests are common - stillness is part of the design', () => {
  const kinds = { rest: 0, sweep: 0, flicker: 0 };
  for (let tick = 1; tick <= 120; tick += 1) kinds[idleAction('FLAPPER', CHARSET, tick).kind] += 1;
  assert.equal(kinds.sweep, 10, 'every 12th tick sweeps');
  assert.ok(kinds.rest >= 30, `rests: ${kinds.rest}`);
  assert.ok(kinds.flicker >= 30, `flickers: ${kinds.flicker}`);
});

test('a fidget lands on any card, blank ones included; nothing at all rests', () => {
  /*
   * This test used to assert the opposite - that spaces never flicker. That
   * was the old rule, and it quietly made a fidget a property of the words
   * rather than of the board. It is the board's now: any card can misfire,
   * blank or not, and a character surfacing in empty space is the point.
   *
   * A board with genuinely nothing on it is still left alone, but that guard
   * lives in ambient.ts (it refuses to run on a blank page), not here.
   */
  let blanksSeen = 0;
  for (let tick = 1; tick <= 200; tick += 1) {
    const action = idleAction('A B', CHARSET, tick);
    if (action.kind === 'flicker' && action.index === 1) blanksSeen += 1;
  }
  assert.ok(blanksSeen > 0, 'the blank in "A B" never once fidgeted');
  assert.equal(idleAction('', CHARSET, 5).kind, 'rest');
});

test('withFlicker swaps exactly one character', () => {
  const action = { kind: 'flicker', index: 2, char: 'X' };
  assert.equal(withFlicker('FLAPPER', action), 'FLXPPER');
  assert.equal(withFlicker('FLAPPER', { kind: 'rest' }), 'FLAPPER');
});

test('a Set charset (what Flipboard actually passes) behaves like the array', () => {
  // charsetFromManifest returns a Set; the wordmark once threw on every
  // ambient beat because idleAction assumed an array.
  const asSet = new Set(CHARSET);
  for (let tick = 0; tick <= 60; tick += 1) {
    assert.deepEqual(idleAction('FLAPPER', asSet, tick), idleAction('FLAPPER', CHARSET, tick));
  }
});

test('a default style is byte-identical to the constants that preceded styles', () => {
  // The whole safety claim of turning three constants into data: every board
  // that names no style must behave exactly as it did before styles existed.
  for (let tick = 0; tick <= 200; tick += 1) {
    const bare = idleAction('FLAPPER', CHARSET, tick);
    const classic = idleAction('FLAPPER', CHARSET, tick, FIDGET_STYLES.classic);
    assert.deepEqual(classic, bare);
  }
});

test('tick misfires to the ring neighbour and nowhere else', () => {
  // The point of the style: a card ticks over, it does not jump the alphabet.
  const ring = [...CHARSET];
  let seen = 0;
  for (let tick = 1; tick <= 300; tick += 1) {
    const action = idleAction('FLAPPER', CHARSET, tick, FIDGET_STYLES.tick);
    if (action.kind !== 'flicker') continue;
    seen += 1;
    const from = 'FLAPPER'[action.index];
    const distance = (ring.indexOf(action.char) - ring.indexOf(from) + ring.length) % ring.length;
    assert.equal(distance, 1, `tick ${tick} moved ${distance} steps, not 1`);
  }
  assert.ok(seen > 0, 'no flickers at all - the assertion above proved nothing');
});

test('a style with no sweeps never sweeps, and one with no flickers never flickers', () => {
  for (let tick = 0; tick <= 200; tick += 1) {
    assert.notEqual(idleAction('FLAPPER', CHARSET, tick, FIDGET_STYLES.tick).kind, 'sweep');
    assert.notEqual(idleAction('FLAPPER', CHARSET, tick, FIDGET_STYLES.sweeping).kind, 'flicker');
  }
});

test('flickerCount is how many tiles misfire at once, and never twice on one', () => {
  let widest = 0;
  for (let tick = 1; tick <= 200; tick += 1) {
    const action = idleAction('FLAPPER', CHARSET, tick, FIDGET_STYLES.twitchy);
    if (action.kind !== 'flicker') continue;
    widest = Math.max(widest, action.picks.length);
    assert.ok(action.picks.length <= FIDGET_STYLES.twitchy.flickerCount);
    const indices = action.picks.map((p) => p.index);
    assert.equal(new Set(indices).size, indices.length, 'one tile picked twice');
    // withFlicker must place every one of them.
    const shown = withFlicker('FLAPPER', action);
    for (const { index, char } of action.picks) assert.equal(shown[index], char);
  }
  assert.ok(widest > 1, 'twitchy never actually flickered more than one tile');
});

test('an unknown style id falls back to classic rather than throwing', () => {
  assert.deepEqual(fidgetStyle('no-such-style'), FIDGET_STYLES.classic);
  assert.deepEqual(fidgetStyle(null), FIDGET_STYLES.classic);
});
