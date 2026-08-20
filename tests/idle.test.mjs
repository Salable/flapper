import test from 'node:test';
import assert from 'node:assert/strict';
import { idleAction, withFlicker } from '../lib/board/idle.mjs';

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

test('spaces never flicker; empty text always rests', () => {
  for (let tick = 1; tick <= 60; tick += 1) {
    const action = idleAction('A B', CHARSET, tick);
    if (action.kind === 'flicker') assert.notEqual(action.index, 1);
    // All-space (and empty) text never flickers - only rests and sweeps.
    assert.notEqual(idleAction('   ', CHARSET, tick).kind, 'flicker');
  }
  assert.equal(idleAction('', CHARSET, 5).kind, 'rest');
});

test('withFlicker swaps exactly one character', () => {
  const action = { kind: 'flicker', index: 2, char: 'X' };
  assert.equal(withFlicker('FLAPPER', action), 'FLXPPER');
  assert.equal(withFlicker('FLAPPER', { kind: 'rest' }), 'FLAPPER');
});
