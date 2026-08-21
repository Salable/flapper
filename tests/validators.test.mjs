import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  textOptions,
  regionOption,
  repeatOption,
  priorityOption,
  rowsOption,
  validateConfigPatch,
} from '../lib/api/validators.mjs';
import { THEME_IDS } from '../lib/board/themes.mjs';

function refused(fn, pattern) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.status, 422, error.message);
    if (pattern) assert.match(error.message, pattern);
    return;
  }
  assert.fail('expected a 422');
}

test('an unknown enum is refused with the list of what is allowed', () => {
  refused(() => textOptions({ text: 'X', priority: 'urgent' }), /priority must be one of normal, next, now/);
  refused(() => textOptions({ text: 'X', align: 'middle' }), /align must be one of left, center, right/);
  refused(() => textOptions({ text: 'X', valign: 'centre' }), /valign must be one of top, middle, bottom/);
  refused(() => textOptions({ text: 'X', wrap: 'wordy' }), /wrap must be one of word, char, none/);
});

test('layout options are refused alongside rows rather than ignored', () => {
  for (const key of ['align', 'valign', 'wrap', 'collapseSpaces']) {
    refused(
      () => textOptions({ rows: ['AB'], [key]: 'left' }),
      new RegExp(`^${key} does not apply when rows is given`),
    );
  }
});

test('rows must be an array of strings', () => {
  refused(() => rowsOption({ rows: 'AB' }));
  refused(() => rowsOption({ rows: [1, 2] }));
  assert.deepEqual(rowsOption({ rows: ['AB', null] }), ['AB', null]);
});

test('rows limits are 413s, not 422s', () => {
  const limits = { ...LIMITS, maxRows: 2, maxTextLength: 4 };
  assert.throws(() => rowsOption({ rows: ['A', 'B', 'C'] }, limits), (e) => e.status === 413);
  assert.throws(() => rowsOption({ rows: ['AAA', 'BB'] }, limits), (e) => e.status === 413);
});

test('an empty region is refused', () => {
  refused(() => regionOption({ region: '  ' }), /region must be a non-empty string/);
  assert.equal(regionOption({}), undefined);
  assert.equal(regionOption({ region: 'footer' }), 'footer');
});

test('repeat must be a boolean, not something coerced into one', () => {
  for (const value of ['true', 1, 0, null]) {
    refused(() => repeatOption({ repeat: value }), /repeat must be true or false/);
  }
  assert.equal(repeatOption({ repeat: true }), true);
  assert.equal(repeatOption({ repeat: false }), false);
});

test('text longer than the limit is a 413', () => {
  const huge = 'A'.repeat(LIMITS.maxTextLength + 1);
  assert.throws(() => textOptions({ text: huge }), (e) => e.status === 413);
});

test('region, priority and repeat survive in both text and rows mode', () => {
  const text = textOptions({ text: 'X', region: 'footer', priority: 'next', repeat: true });
  assert.deepEqual(text.options, { region: 'footer', priority: 'next', repeat: true });
  const rows = textOptions({ rows: ['AB'], region: 'footer', priority: 'now', repeat: true });
  assert.equal(rows.options.region, 'footer');
  assert.equal(rows.options.priority, 'now');
  assert.equal(rows.options.repeat, true);
});

test('dwellMs must be a non-negative number in both modes', () => {
  refused(() => textOptions({ text: 'X', dwellMs: -5 }));
  refused(() => textOptions({ rows: ['A'], dwellMs: 'soon' }));
  assert.equal(textOptions({ text: 'X', dwellMs: '1500' }).options.dwellMs, 1500);
});

test('footerRows must be a non-negative integer', () => {
  for (const value of [-2, 1.5, 'two', null]) {
    refused(() => validateConfigPatch({ footerRows: value }), /footerRows must be a non-negative integer/);
  }
  assert.deepEqual(validateConfigPatch({ footerRows: 2 }), { footerRows: 2 });
});

test('theme must be one this build ships', () => {
  refused(() => validateConfigPatch({ theme: 'tartan' }), new RegExp(`theme must be one of ${THEME_IDS.join(', ')}`));
  refused(() => validateConfigPatch({ theme: null }), /theme must be one of/);
  assert.deepEqual(validateConfigPatch({ theme: 'canary' }), { theme: 'canary' });
  assert.deepEqual(validateConfigPatch({ theme: 'classic' }), { theme: 'classic' });
});

test('per-band settings are shape-checked', () => {
  refused(() => validateConfigPatch({ regions: [] }), /regions must be an object/);
  refused(() => validateConfigPatch({ regions: { footer: 5 } }), /regions.footer must be an object/);
  refused(
    () => validateConfigPatch({ regions: { footer: { align: 'left' } } }),
    /regions.footer.align is not a per-band setting/,
  );
  refused(
    () => validateConfigPatch({ regions: { footer: { dwellMs: -1 } } }),
    /regions.footer.dwellMs must be a non-negative number or null/,
  );
  validateConfigPatch({ regions: { footer: { dwellMs: 8000 } } });
  validateConfigPatch({ regions: { footer: { dwellMs: null } } });
});
