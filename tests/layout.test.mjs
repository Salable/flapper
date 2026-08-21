import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layout,
  layoutRows,
  normalize,
  charsetFromManifest,
  DEFAULT_SUBSTITUTIONS,
} from '../lib/board/layout.mjs';
import { RING } from '../lib/board/ring.mjs';

const manifest = { cycle: RING };
const charset = charsetFromManifest(manifest);

/** Lay out and strip padding, so assertions read like the visible text. */
function lines(text, options) {
  const { pages } = layout(text, { charset, ...options });
  return pages.map((page) => page.map((line) => line.trimEnd()));
}

test('charset is exactly what the art provides', () => {
  assert.equal([...charset].join(''), ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!()');
});

test('every page is exactly rows x cols', () => {
  const { pages } = layout('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG AND KEEPS RUNNING', {
    charset,
    cols: 12,
    rows: 3,
  });
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.equal(page.length, 3);
    for (const line of page) assert.equal(line.length, 12);
  }
});

test('wraps on word boundaries', () => {
  assert.deepEqual(lines('NOW BOARDING GATE 14', { cols: 10, rows: 3, align: 'left' }), [
    ['NOW', 'BOARDING', 'GATE 14'],
  ]);
});

test('paginates when the text exceeds the grid', () => {
  // A 1x10 board holds one short word at a time.
  assert.deepEqual(lines('NOW BOARDING GATE 14', { cols: 10, rows: 1, align: 'left' }), [
    ['NOW'],
    ['BOARDING'],
    ['GATE 14'],
  ]);
});

test('a long sentence fills a large grid without paginating', () => {
  const text =
    'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG WHILE THE BAND PLAYS ON INTO THE NIGHT';
  const { pages, diagnostics } = layout(text, { charset, cols: 40, rows: 20 });
  assert.equal(pages.length, 1, 'should fit one page');
  assert.ok(diagnostics.lineCount <= 20);
});

test('normalises all line ending conventions', () => {
  for (const eol of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
    assert.deepEqual(
      lines(`AB${eol}CD`, { cols: 4, rows: 2, align: 'left' }),
      [['AB', 'CD']],
      `failed for ${JSON.stringify(eol)}`,
    );
  }
});

test('explicit line breaks are honoured', () => {
  assert.deepEqual(lines('ONE\nTWO\nTHREE', { cols: 8, rows: 3, align: 'left' }), [
    ['ONE', 'TWO', 'THREE'],
  ]);
});

test('a blank line is preserved as a paragraph gap', () => {
  const [page] = lines('ONE\n\nTWO', { cols: 8, rows: 3, align: 'left' });
  assert.deepEqual(page, ['ONE', '', 'TWO']);
});

test('no page begins with a blank line', () => {
  // The gap after ONE would otherwise land at the top of page 2.
  const pages = lines('ONE\n\nTWO', { cols: 8, rows: 1, align: 'left' });
  assert.deepEqual(pages, [['ONE'], ['TWO']]);
});

test('lowercase is uppercased', () => {
  assert.deepEqual(lines('hello', { cols: 8, rows: 1, align: 'left' }), [['HELLO']]);
});

test('accents are folded rather than dropped', () => {
  assert.deepEqual(lines('café', { cols: 8, rows: 1, align: 'left' }), [['CAFE']]);
  assert.deepEqual(lines('mañana Über', { cols: 16, rows: 1, align: 'left' }), [['MANANA UBER']]);
});

test('punctuation maps onto glyphs that exist', () => {
  assert.deepEqual(lines('WHAT?', { cols: 8, rows: 1, align: 'left' }), [['WHAT.']]);
  assert.deepEqual(lines('YES; NO', { cols: 8, rows: 1, align: 'left' }), [['YES, NO']]);
  assert.deepEqual(lines('NOTE: OK', { cols: 10, rows: 1, align: 'left' }), [['NOTE. OK']]);
  assert.deepEqual(lines('WAIT…', { cols: 8, rows: 1, align: 'left' }), [['WAIT...']]);
  assert.deepEqual(lines('[A]', { cols: 8, rows: 1, align: 'left' }), [['(A)']]);
});

test('apostrophes and quotes are removed, not spaced', () => {
  assert.deepEqual(lines("DON'T", { cols: 8, rows: 1, align: 'left' }), [['DONT']]);
  assert.deepEqual(lines('“HI”', { cols: 8, rows: 1, align: 'left' }), [['HI']]);
});

test('dashes become word gaps', () => {
  assert.deepEqual(lines('WELL-KNOWN', { cols: 12, rows: 1, align: 'left' }), [['WELL KNOWN']]);
  assert.deepEqual(lines('A—B', { cols: 8, rows: 1, align: 'left' }), [['A B']]);
});

test('ampersand and at expand to words without doubling spaces', () => {
  assert.deepEqual(lines('R&D', { cols: 10, rows: 1, align: 'left' }), [['R AND D']]);
  assert.deepEqual(lines('ROCK & ROLL', { cols: 16, rows: 1, align: 'left' }), [['ROCK AND ROLL']]);
  assert.deepEqual(lines('ME@HOME', { cols: 12, rows: 1, align: 'left' }), [['ME AT HOME']]);
});

test('genuinely undisplayable characters are dropped and reported', () => {
  const { diagnostics } = layout('50% #1 ~X', { charset, cols: 20, rows: 1 });
  const reported = diagnostics.unsupported.map((u) => u.char).sort();
  assert.deepEqual(reported, ['#', '%', '~']);
});

test('substitutions are reported with counts', () => {
  const { diagnostics } = layout('A?B?C', { charset, cols: 20, rows: 1 });
  const q = diagnostics.substitutions.find((s) => s.from === '?');
  assert.equal(q.to, '.');
  assert.equal(q.count, 2);
});

test('a word longer than the grid is hard-broken and reported', () => {
  const [page] = lines('ABCDEFGHIJKLMNO', { cols: 6, rows: 3, align: 'left' });
  assert.deepEqual(page, ['ABCDEF', 'GHIJKL', 'MNO']);
  const { diagnostics } = layout('ABCDEFGHIJKLMNO', { charset, cols: 6, rows: 3 });
  assert.deepEqual(diagnostics.brokenWords, ['ABCDEFGHIJKLMNO']);
});

test('horizontal alignment', () => {
  const opts = { charset, cols: 7, rows: 1 };
  assert.equal(layout('HI', { ...opts, align: 'left' }).pages[0][0], 'HI     ');
  assert.equal(layout('HI', { ...opts, align: 'center' }).pages[0][0], '  HI   ');
  assert.equal(layout('HI', { ...opts, align: 'right' }).pages[0][0], '     HI');
});

test('vertical alignment', () => {
  const opts = { charset, cols: 2, rows: 3, align: 'left' };
  assert.deepEqual(layout('HI', { ...opts, valign: 'top' }).pages[0], ['HI', '  ', '  ']);
  assert.deepEqual(layout('HI', { ...opts, valign: 'middle' }).pages[0], ['  ', 'HI', '  ']);
  assert.deepEqual(layout('HI', { ...opts, valign: 'bottom' }).pages[0], ['  ', '  ', 'HI']);
});

test('empty and whitespace-only input give one blank page', () => {
  for (const input of ['', '   ', '\n\n', null, undefined]) {
    const { pages } = layout(input, { charset, cols: 4, rows: 2 });
    assert.equal(pages.length, 1, `failed for ${JSON.stringify(input)}`);
    assert.deepEqual(pages[0], ['    ', '    ']);
  }
});

test('word wrap normalises inter-word spacing', () => {
  assert.deepEqual(lines('A     B', { cols: 8, rows: 1, align: 'left' }), [['A B']]);
  // Word wrap re-flows, so collapseSpaces cannot preserve runs here.
  const reflowed = layout('A   B', {
    charset,
    cols: 8,
    rows: 1,
    align: 'left',
    collapseSpaces: false,
  });
  assert.equal(reflowed.pages[0][0], 'A B     ');
});

test("wrap 'none' preserves exact spacing for hand-composed blocks", () => {
  const composed = layout('A   B\n  C', {
    charset,
    cols: 8,
    rows: 2,
    align: 'left',
    valign: 'top',
    wrap: 'none',
    collapseSpaces: false,
  });
  assert.deepEqual(composed.pages[0], ['A   B   ', '  C     ']);
});

test("wrap 'none' clips long lines and reports them", () => {
  const { pages, diagnostics } = layout('ABCDEFGHIJ', {
    charset,
    cols: 4,
    rows: 1,
    wrap: 'none',
  });
  assert.equal(pages[0][0], 'ABCD');
  assert.deepEqual(diagnostics.clippedLines, ['ABCDEFGHIJ']);
});

test("wrap 'char' hard-breaks without re-flowing words", () => {
  const { pages } = layout('ABCDEFGH', { charset, cols: 4, rows: 2, wrap: 'char', valign: 'top' });
  assert.deepEqual(pages[0], ['ABCD', 'EFGH']);
});

test('page count is capped and the truncation reported', () => {
  const many = Array.from({ length: 50 }, (_, i) => `WORD${i}`).join('\n');
  const { pages, diagnostics } = layout(many, { charset, cols: 8, rows: 1, maxPages: 10 });
  assert.equal(pages.length, 10);
  assert.equal(diagnostics.truncated, true);
});

test('substitutions can be overridden per call', () => {
  const { pages } = layout('A&B', {
    charset,
    cols: 8,
    rows: 1,
    align: 'left',
    substitutions: { ...DEFAULT_SUBSTITUTIONS, '&': '' },
  });
  assert.equal(pages[0][0].trimEnd(), 'AB');
});

test('normalize reports without laying out', () => {
  const result = normalize('Hi — there?', { charset });
  assert.equal(result.text, 'HI   THERE.');
  assert.ok(result.substitutions.some((s) => s.from === '—'));
});

test('a 60x30 wall of prose lays out to exact dimensions', () => {
  const prose = Array.from({ length: 40 }, () =>
    'THE BOARD FLIPS FORWARD THROUGH EVERY GLYPH UNTIL IT SETTLES.',
  ).join(' ');
  const { pages } = layout(prose, { charset, cols: 60, rows: 30 });
  for (const page of pages) {
    assert.equal(page.length, 30);
    for (const line of page) assert.equal(line.length, 60);
  }
});

/* ---- layoutRows: explicit, cell-level control ---- */

test('rows are taken literally, one character per tile', () => {
  const { pages } = layoutRows(['AB', '  CD'], { charset, cols: 6, rows: 3 });
  assert.deepEqual(pages[0], ['AB    ', '  CD  ', '      ']);
});

test('rows preserve exact spacing regardless of alignment settings', () => {
  // align/valign are meaningless here: the caller placed the characters.
  const { pages } = layoutRows(['  X  '], { charset, cols: 5, rows: 1, align: 'right' });
  assert.equal(pages[0][0], '  X  ');
});

test('rows never change width, so cell indices stay put', () => {
  // In prose mode '&' becomes ' AND ' and would shift everything after it.
  const { pages, diagnostics } = layoutRows(['A&B?C'], { charset, cols: 5, rows: 1 });
  assert.equal(pages[0][0].length, 5);
  assert.equal(pages[0][0][0], 'A');
  assert.equal(pages[0][0][1], ' ', 'width-changing substitution blanks the cell');
  assert.equal(pages[0][0][2], 'B');
  assert.equal(pages[0][0][3], '.', '1:1 substitution still applies');
  assert.equal(pages[0][0][4], 'C');
  assert.ok(diagnostics.unsupported.some((u) => u.char === '&'));
  assert.ok(diagnostics.substitutions.some((s) => s.from === '?' && s.to === '.'));
});

test('rows fold case and accents without shifting', () => {
  const { pages } = layoutRows(['café'], { charset, cols: 4, rows: 1 });
  assert.equal(pages[0][0], 'CAFE');
});

test('rows clip to the grid and report it', () => {
  const { pages, diagnostics } = layoutRows(['ABCDEFGH', 'X', 'Y'], {
    charset,
    cols: 4,
    rows: 2,
  });
  assert.deepEqual(pages[0], ['ABCD', 'X   ']);
  assert.deepEqual(diagnostics.clippedLines, ['ABCDEFGH']);
  assert.equal(diagnostics.truncated, true, 'the third row was dropped');
});

test('rows accept null and short entries as blanks', () => {
  const { pages } = layoutRows([null, 'A', undefined], { charset, cols: 3, rows: 3 });
  assert.deepEqual(pages[0], ['   ', 'A  ', '   ']);
});

test('rows always produce exactly one page', () => {
  const { pages, diagnostics } = layoutRows(Array(50).fill('A'), { charset, cols: 2, rows: 4 });
  assert.equal(pages.length, 1);
  assert.equal(diagnostics.pageCount, 1);
});

test('a hand-composed frame survives the round trip intact', () => {
  const frame = [
    '  **  ',
    ' *  * ',
    '*    *',
  ].map((line) => line.replace(/\*/g, 'O'));
  const { pages } = layoutRows(frame, { charset, cols: 6, rows: 3 });
  assert.deepEqual(pages[0], ['  OO  ', ' O  O ', 'O    O']);
});
