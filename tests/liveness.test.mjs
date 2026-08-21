import test from 'node:test';
import assert from 'node:assert/strict';
import { displayHealth, STALE_MS, FROZEN_MS } from '../lib/api/liveness.mjs';

const now = 1_000_000;
const state = (snapshot, ago = 0) => ({ updatedAt: now - ago, snapshot });

test('no state is stale, not frozen', () => {
  assert.deepEqual(displayHealth(null, now), {
    boardReady: false,
    stale: true,
    frozen: false,
    updatedAt: null,
    display: null,
  });
});

test('a fresh visible display is ready and neither stale nor frozen', () => {
  const h = displayHealth(state({ animating: true, display: { visibility: 'visible', lastFrameAgeMs: 16 } }), now);
  assert.equal(h.boardReady, true);
  assert.equal(h.stale, false);
  assert.equal(h.frozen, false);
});

test('silence past STALE_MS is stale, and stale is never also frozen', () => {
  const h = displayHealth(state({ animating: true, display: { visibility: 'hidden' } }, STALE_MS + 1), now);
  assert.equal(h.stale, true);
  assert.equal(h.boardReady, false);
  assert.equal(h.frozen, false);
});

test('a hidden tab is frozen even while its heartbeat keeps it connected', () => {
  const h = displayHealth(state({ animating: false, display: { visibility: 'hidden', lastFrameAgeMs: 0 } }), now);
  assert.equal(h.boardReady, true, 'still connected');
  assert.equal(h.frozen, true);
});

test('animating with no frame for FROZEN_MS is frozen; idle with no frames is fine', () => {
  const stuck = { visibility: 'visible', lastFrameAgeMs: FROZEN_MS + 1 };
  assert.equal(displayHealth(state({ animating: true, display: stuck }), now).frozen, true);
  assert.equal(displayHealth(state({ animating: false, display: stuck }), now).frozen, false, 'idle draws no frames');
  assert.equal(displayHealth(state({ animating: true, display: { visibility: 'visible', lastFrameAgeMs: 500 } }), now).frozen, false);
});

test('a display that predates the stamp is never called frozen', () => {
  const h = displayHealth(state({ animating: true, lines: ['HI'] }), now);
  assert.equal(h.frozen, false);
  assert.equal(h.display, null);
});
