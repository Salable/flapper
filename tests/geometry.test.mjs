import test from 'node:test';
import assert from 'node:assert/strict';

import { rowsThatFit, clampRows, fitInRegion, MAX_ROWS } from '../lib/board/geometry.mjs';

test('a screen shape turns cards across into cards down', () => {
  // 20 square cards across a 16:9 screen: 20 / (16/9) = 11.25 -> 11.
  assert.equal(rowsThatFit(20, 16, 9), 11);
  // The same 20 across a portrait panel is a much taller board.
  assert.equal(rowsThatFit(20, 9, 16), 36);
  // Square screen, square cards: a square grid.
  assert.equal(rowsThatFit(20, 1, 1), 20);
});

test('taller cards mean fewer rows', () => {
  // A card 1.25x taller than it is wide fills the same height in fewer rows.
  assert.equal(rowsThatFit(20, 16, 9, 1.25), 9);
  assert.ok(rowsThatFit(20, 16, 9, 1.25) < rowsThatFit(20, 16, 9, 1));
});

test('the row count stays inside what a board may have', () => {
  // A very tall screen would ask for more rows than a board can hold.
  assert.equal(rowsThatFit(80, 1, 40), MAX_ROWS);
  assert.equal(rowsThatFit(1, 40, 1), 1);
  assert.equal(clampRows(0), 1);
  assert.equal(clampRows(999), MAX_ROWS);
});

test('nonsense in gives one row rather than NaN', () => {
  for (const bad of [[0, 16, 9], [20, 0, 9], [20, 16, 0], ['wide', 16, 9], [20, 16, 9, 0]]) {
    assert.equal(rowsThatFit(...bad), 1);
  }
});

test('a board either fills its region or leaves bands on one axis', () => {
  // 20x8 is 2.5:1. A region of the same shape is exact.
  assert.equal(fitInRegion(20, 8, 2.5, 1), 'exact');
  // A wider region than the board: the board fits the height, bands at the sides.
  assert.equal(fitInRegion(20, 8, 4, 1), 'bands-sides');
  // A taller region - a portrait wall - fits the width and bands top and bottom.
  assert.equal(fitInRegion(20, 8, 9, 16), 'bands-top-bottom');
});
