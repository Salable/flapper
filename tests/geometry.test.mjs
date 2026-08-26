import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rowsThatFit,
  clampRows,
  fitInRegion,
  gridFor,
  screenLabel,
  MAX_ROWS,
  MAX_COLS,
} from '../lib/board/geometry.mjs';

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

test('a screen is a shape in any units, and the board is scale all the way down', () => {
  /*
   * Nothing about what gets drawn depends on how big the glass physically is.
   * A board fills the window it is in, so two 16:9 screens of different sizes
   * showing the same board look the same, one just bigger - which makes a
   * measurement a number with no effect. So a screen is proportions, given in
   * whatever units somebody has to hand.
   */
  const asRatio = gridFor('medium', { w: 16, h: 9 });
  assert.deepEqual(gridFor('medium', { w: 1920, h: 1080 }), asRatio, 'pixels');
  assert.deepEqual(gridFor('medium', { w: 121.8, h: 68.5 }), asRatio, 'centimetres');
  assert.deepEqual(screenLabel({ w: 1920, h: 1080 }), '16:9', 'and all reduce to the same shape');

  // A ticker over a door: 300cm by 20cm, which no aspect preset offers.
  // Cols scales up for how wide this is (huge: 8 on a 16:9 wall, 24 here) -
  // tiny wants more still, but 80 is the board's own hard cap.
  assert.equal(screenLabel({ w: 300, h: 20 }), '15:1');
  assert.deepEqual(gridFor('tiny', { w: 300, h: 20 }), { cols: MAX_COLS, rows: 5 });
  assert.deepEqual(gridFor('huge', { w: 300, h: 20 }), { cols: 24, rows: 2 });

  // A shape it cannot make sense of falls back rather than throwing.
  for (const bad of [undefined, null, {}, { w: 0, h: 0 }, { w: NaN, h: 9 }]) {
    const grid = gridFor('medium', bad);
    assert.ok(Number.isInteger(grid.cols) && grid.cols >= 1, JSON.stringify(bad));
    assert.ok(Number.isInteger(grid.rows) && grid.rows >= 1, JSON.stringify(bad));
  }
})

test('rotating the same screen holds roughly the same number of cards', () => {
  // The bug this guards: cols used to be flat regardless of shape, so
  // turning a 16:9 wall to portrait 9:16 kept 20 across and let rows blow
  // out to 36 to stay square - 720 cards for the same physical screen that
  // held 220 landscape. Cols now scales with the shape instead, so the
  // total stays close - exactly equal at these two, since 9:16 is 16:9
  // exactly transposed.
  const landscape = gridFor('medium', { w: 16, h: 9 });
  const portrait = gridFor('medium', { w: 9, h: 16 });
  assert.deepEqual(landscape, { cols: 20, rows: 11 });
  assert.deepEqual(portrait, { cols: 11, rows: 20 });
  assert.equal(landscape.cols * landscape.rows, portrait.cols * portrait.rows);
})
