import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN,
  FOOTER,
  resolveRegions,
  footerLayout,
  regionCoords,
  regionTargets,
  composeLines,
} from '../lib/board/regions.mjs';

/** A tiny charset stand-in: A-C map to 1-3, everything else is blank (0). */
const charToState = new Map([['A', 1], ['B', 2], ['C', 3]]);
const BLANK = 0;

test('a footer band takes the bottom rows and the queue keeps the rest', () => {
  const regions = footerLayout(20, 8, 2);
  assert.deepEqual(regions, [
    { id: MAIN, top: 0, height: 6, start: 0, end: 120 },
    { id: FOOTER, top: 6, height: 2, start: 120, end: 160 },
  ]);
});

test('no footer means a single band spanning the board', () => {
  const regions = footerLayout(20, 8, 0);
  assert.equal(regions.length, 1, 'a zero-height band is dropped, not kept empty');
  assert.deepEqual(regions[0], { id: MAIN, top: 0, height: 8, start: 0, end: 160 });
});

test('bands always tile the grid exactly', () => {
  for (let rows = 1; rows <= 40; rows += 1) {
    for (let footerRows = 0; footerRows <= rows + 1; footerRows += 1) {
      const regions = footerLayout(7, rows, footerRows);
      const label = `rows=${rows} footerRows=${footerRows}`;

      assert.equal(
        regions.reduce((sum, region) => sum + region.height, 0),
        rows,
        `heights must sum to the grid height (${label})`,
      );
      assert.equal(regions[0].start, 0, `must start at tile 0 (${label})`);
      assert.equal(regions.at(-1).end, 7 * rows, `must end at the last tile (${label})`);

      for (let i = 1; i < regions.length; i += 1) {
        assert.equal(regions[i].start, regions[i - 1].end, `no gap or overlap (${label})`);
        assert.equal(regions[i].top, regions[i - 1].top + regions[i - 1].height, label);
      }
      for (const region of regions) {
        assert.ok(region.height > 0, `no empty bands (${label})`);
      }
    }
  }
});

test('the queue always keeps at least one row', () => {
  for (const [rows, footerRows] of [[8, 8], [8, 99], [4, 4], [1, 1], [1, 5], [2, 2]]) {
    const regions = footerLayout(10, rows, footerRows);
    const main = regions.find((region) => region.id === MAIN);
    assert.ok(main, `main band must survive footerRows=${footerRows} on ${rows} rows`);
    assert.ok(main.height >= 1, `main must keep a row (rows=${rows}, footer=${footerRows})`);
  }
});

test('a one-row board cannot have a footer', () => {
  const regions = footerLayout(10, 1, 3);
  assert.deepEqual(regions.map((region) => region.id), [MAIN]);
  assert.equal(regions[0].height, 1);
});

test('a nonsense footer height is treated as none', () => {
  for (const value of [undefined, null, NaN, -4, 'abc']) {
    const regions = footerLayout(10, 6, value);
    assert.equal(regions.length, 1, `footerRows=${String(value)} should yield one band`);
    assert.equal(regions[0].height, 6);
  }
});

test('a fractional footer height is floored', () => {
  const regions = footerLayout(10, 6, 2.9);
  assert.equal(regions.find((region) => region.id === FOOTER).height, 2);
});

test('resolveRegions refuses a set of bands with no flexible one', () => {
  assert.throws(
    () => resolveRegions(10, 8, [{ id: 'a', rows: 4 }, { id: 'b', rows: 4 }]),
    /exactly one band without a row count/,
  );
});

test('coordinates are relative to the band, not the board', () => {
  const [, footer] = footerLayout(4, 6, 2);
  // First tile of the footer is board row 4, but band row 0 - this is the
  // difference between a sweep that starts late and one that starts at once.
  assert.deepEqual(regionCoords(footer.start, 4, footer), { row: 0, col: 0 });
  assert.deepEqual(regionCoords(footer.start + 3, 4, footer), { row: 0, col: 3 });
  assert.deepEqual(regionCoords(footer.start + 4, 4, footer), { row: 1, col: 0 });
});

test('targets cover exactly the band, whatever the input', () => {
  const [, footer] = footerLayout(4, 6, 2);
  for (const lines of [undefined, null, [], ['AB'], ['AB', 'C', 'EXTRA'], 'nonsense']) {
    const targets = regionTargets(lines, footer, 4, charToState, BLANK);
    assert.equal(targets.length, 8, `must be cols * height for ${JSON.stringify(lines)}`);
  }
});

test('targets place characters band-relative and blank the rest', () => {
  const [, footer] = footerLayout(4, 6, 2);
  const targets = regionTargets(['AB', 'C'], footer, 4, charToState, BLANK);
  assert.deepEqual(targets, [1, 2, 0, 0, 3, 0, 0, 0]);
});

test('unknown characters fall back to blank', () => {
  const [main] = footerLayout(3, 1, 0);
  assert.deepEqual(regionTargets(['AZB'], main, 3, charToState, BLANK), [1, 0, 2]);
});

test('composeLines stitches the bands back into one page', () => {
  const regions = footerLayout(4, 4, 1);
  const lines = { main: ['AA', 'BB', 'CC'], footer: ['CAB'] };
  assert.deepEqual(composeLines(regions, 4, (region) => lines[region.id]), [
    'AA  ',
    'BB  ',
    'CC  ',
    'CAB ',
  ]);
});

test('composeLines pads a band that has never been shown', () => {
  const regions = footerLayout(3, 2, 1);
  assert.deepEqual(composeLines(regions, 3, () => undefined), ['   ', '   ']);
});
