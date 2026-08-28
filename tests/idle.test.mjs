import test from 'node:test';
import assert from 'node:assert/strict';
import { idleAction, withFlicker } from '../lib/board/idle.mjs';

/*
 * The wordmark's idle animation, which is not a board fidget - see
 * tests/fidgets.test.mjs for those. This file briefly tested both, while the
 * first attempt at board fidgets was growing out of this module; that model
 * is gone and these are back to covering the one small thing this does.
 */

const CHARSET = [' ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];

test('the sequence is deterministic and total over any tick', () => {
  for (let tick = 0; tick < 500; tick += 1) {
    const a = idleAction('FLAPPER', CHARSET, tick);
    const b = idleAction('FLAPPER', CHARSET, tick);
    assert.deepEqual(a, b, `tick ${tick} disagreed with itself`);
    assert.ok(['rest', 'sweep', 'flicker'].includes(a.kind));
  }
});

test('sweeps are rare and rests are common - stillness is part of the design', () => {
  const kinds = { rest: 0, sweep: 0, flicker: 0 };
  for (let tick = 1; tick <= 120; tick += 1) kinds[idleAction('FLAPPER', CHARSET, tick).kind] += 1;
  assert.equal(kinds.sweep, 10, 'every 12th tick sweeps');
  // Roughly half and half between resting and flickering, and not asserted
  // any tighter than that: the split comes from a hash, so demanding rest >
  // flicker is demanding something the model never promised.
  assert.ok(kinds.rest >= 30, `rests: ${kinds.rest}`);
  assert.ok(kinds.flicker >= 30, `flickers: ${kinds.flicker}`);
});

test('spaces never flicker; empty text always rests', () => {
  /*
   * The wordmark is a word. A character surfacing in the gap beside it reads
   * as a typo rather than as wear - which is the opposite of a *board*
   * fidget, where landing on a blank card is exactly the point.
   */
  for (let tick = 1; tick <= 60; tick += 1) {
    const action = idleAction('A B', CHARSET, tick);
    if (action.kind === 'flicker') assert.notEqual(action.index, 1);
    assert.notEqual(idleAction('   ', CHARSET, tick).kind, 'flicker');
  }
  assert.equal(idleAction('', CHARSET, 5).kind, 'rest');
});

test('withFlicker swaps exactly one character', () => {
  const action = { kind: 'flicker', index: 2, char: 'X' };
  assert.equal(withFlicker('FLAPPER', action), 'FLXPPER');
  assert.equal(withFlicker('FLAPPER', { kind: 'rest' }), 'FLAPPER');
});

test('a Set charset (what Flipboard actually passes) behaves like the array', () => {
  // A Set went in once where an array was expected and every tile skipped its
  // ambient beat because idleAction assumed an array.
  const asSet = new Set(CHARSET);
  for (let tick = 0; tick < 50; tick += 1) {
    assert.deepEqual(idleAction('FLAPPER', asSet, tick), idleAction('FLAPPER', CHARSET, tick));
  }
});
