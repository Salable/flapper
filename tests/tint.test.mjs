import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateHue,
  driftAngle,
  driftPeriod,
  cornersGrid,
  parseHex,
  axisPosition,
  gradientGrid,
  tintGrid,
  tintMode,
  tintStrength,
  TINT_MODES,
} from '../lib/board/tint.mjs';

test('hex parses in both lengths, and nothing else does', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#F0E9DF'), [240, 233, 223]);
  assert.deepEqual(parseHex('  #000000  '), [0, 0, 0]);
  for (const bad of ['fff', '#ff', '#gggggg', 'rebeccapurple', null, 12]) {
    assert.equal(parseHex(bad), null);
  }
});

test('the two stops land on opposite corners whatever the angle', () => {
  // Across: first column is the start, last column the end.
  assert.equal(axisPosition(0, 0, 20, 8, 0), 0);
  assert.equal(axisPosition(19, 0, 20, 8, 0), 1);
  // Down: first row is the start.
  assert.equal(axisPosition(0, 0, 20, 8, 90), 0);
  assert.equal(axisPosition(0, 7, 20, 8, 90), 1);
  // Corner to corner: top-left starts, bottom-right ends, middle is halfway.
  assert.equal(axisPosition(0, 0, 20, 8, 45), 0);
  assert.equal(axisPosition(19, 7, 20, 8, 45), 1);
  assert.ok(Math.abs(axisPosition(9, 3, 20, 8, 45) - 0.5) < 0.06);
});

test('a single row or column still lands somewhere sensible', () => {
  // Nothing to interpolate across, so the cell sits in the middle of the axis
  // rather than dividing by zero.
  assert.equal(axisPosition(0, 0, 1, 8, 0), 0.5);
  assert.equal(axisPosition(0, 0, 20, 1, 90), 0.5);
});

test('a gradient gives one colour per cell, in row-major order', () => {
  const grid = gradientGrid({ from: '#000000', to: '#ffffff', angle: 0 }, 3, 2);
  assert.equal(grid.length, 6);
  // Left edge is the from colour, right edge the to colour, on both rows.
  assert.deepEqual(grid[0], { r: 0, g: 0, b: 0 });
  assert.deepEqual(grid[2], { r: 255, g: 255, b: 255 });
  assert.deepEqual(grid[3], { r: 0, g: 0, b: 0 });
  assert.deepEqual(grid[5], { r: 255, g: 255, b: 255 });
  // And the middle is halfway.
  assert.deepEqual(grid[1], { r: 128, g: 128, b: 128 });
});

test('a pastel gradient stays pastel all the way across', () => {
  const grid = gradientGrid({ from: '#f6d5e0', to: '#d3e4f7', angle: 45 }, 20, 8);
  assert.equal(grid.length, 160);
  // Every cell is light: nothing on the way between two pale colours is dark.
  for (const cell of grid) {
    assert.ok(cell.r > 200 && cell.g > 200 && cell.b > 220, `too dark: ${JSON.stringify(cell)}`);
  }
});

test('an unusable gradient is no gradient rather than a crash', () => {
  assert.equal(gradientGrid({ from: 'pink', to: '#fff' }, 20, 8), null);
  assert.equal(gradientGrid({ from: '#fff' }, 20, 8), null);
  assert.equal(gradientGrid({ from: '#000', to: '#fff' }, 0, 8), null);
  assert.equal(tintGrid(null, 20, 8), null);
  assert.equal(tintGrid({}, 20, 8), null);
});

test('the mode defaults to the one that protects black and white glyphs', () => {
  assert.equal(tintMode(undefined), TINT_MODES.overlay);
  assert.equal(tintMode({ mode: 'nonsense' }), TINT_MODES.overlay);
  assert.equal(tintMode({ mode: 'multiply' }), 'multiply');
  assert.equal(tintMode({ mode: 'wash' }), 'source-over');
});

test('strength is a fraction, and a missing one is full', () => {
  assert.equal(tintStrength(undefined), 1);
  assert.equal(tintStrength({ strength: 0.4 }), 0.4);
  assert.equal(tintStrength({ strength: -3 }), 0);
  assert.equal(tintStrength({ strength: 99 }), 1);
  assert.equal(tintStrength({ strength: 'lots' }), 1);
});

test('four corners blend across the grid in both directions', () => {
  // Each corner is itself, and the middle is the average of all four.
  const grid = cornersGrid(
    { tl: '#ff0000', tr: '#00ff00', bl: '#0000ff', br: '#ffffff' },
    3,
    3,
  );
  assert.deepEqual(grid[0], { r: 255, g: 0, b: 0 }, 'top left');
  assert.deepEqual(grid[2], { r: 0, g: 255, b: 0 }, 'top right');
  assert.deepEqual(grid[6], { r: 0, g: 0, b: 255 }, 'bottom left');
  assert.deepEqual(grid[8], { r: 255, g: 255, b: 255 }, 'bottom right');
  assert.deepEqual(grid[4], { r: 128, g: 128, b: 128 }, 'the middle is all four');
});

test('corners do what a single axis cannot', () => {
  // The point of corners: two cells on a line square to a gradient's axis are
  // the same colour, and with four corners they are not.
  const grid = cornersGrid({ tl: '#ff0000', tr: '#ff0000', bl: '#0000ff', br: '#00ff00' }, 3, 3);
  assert.notDeepEqual(grid[6], grid[8], 'the bottom corners differ');
  assert.deepEqual(grid[0], grid[2], 'the top ones were told to match');
});

test('a one-row board of corners sits in the middle of its axis', () => {
  const grid = cornersGrid({ tl: '#000000', tr: '#000000', bl: '#ffffff', br: '#ffffff' }, 2, 1);
  // Not simply the top edge: halfway between top and bottom.
  assert.deepEqual(grid[0], { r: 128, g: 128, b: 128 });
});

test('corners need all four, and take precedence over a gradient', () => {
  assert.equal(cornersGrid({ tl: '#fff', tr: '#fff', bl: '#fff' }, 3, 3), null);
  assert.equal(cornersGrid(null, 3, 3), null);
  const both = tintGrid(
    { corners: { tl: '#ffffff', tr: '#ffffff', bl: '#ffffff', br: '#ffffff' }, gradient: { from: '#000000', to: '#000000' } },
    2,
    1,
  );
  assert.deepEqual(both[0], { r: 255, g: 255, b: 255 }, 'corners win');
});

test('a drift turns once per period, in whole degrees', () => {
  assert.equal(driftPeriod({ drift: { periodMs: 12000 } }), 12000);
  assert.equal(driftPeriod({ drift: { periodMs: 10 } }), 0, 'a strobe is refused');
  assert.equal(driftPeriod({}), 0);
  assert.equal(driftAngle(12000, 0), 0);
  assert.equal(driftAngle(12000, 6000), 180);
  assert.equal(driftAngle(12000, 12000), 0);
});

test('rotating hue changes the colour and keeps the brightness', () => {
  const red = { r: 220, g: 60, b: 60 };
  const turned = rotateHue(red, 120);
  assert.notDeepEqual(turned, red);
  // Luminance-preserving, because the glyph has to stay readable against it
  // all the way round the turn.
  const luma = (c) => 0.213 * c.r + 0.715 * c.g + 0.072 * c.b;
  assert.ok(Math.abs(luma(turned) - luma(red)) < 3, `${luma(turned)} vs ${luma(red)}`);
  assert.deepEqual(rotateHue(red, 0), red, 'no turn is no change');
});
