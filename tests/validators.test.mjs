import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  textOptions,
  regionOption,
  repeatOption,
  priorityOption,
  labelOption,
  interruptOption,
  rowsOption,
  validateConfigPatch,
  validateInterrupterPreset,
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

test('a label is a name for the item, not the text, and is capped like one', () => {
  assert.equal(labelOption({}), undefined);
  refused(() => labelOption({ label: 42 }), /label must be text/);
  refused(() => labelOption({ label: 'x'.repeat(61) }), /label is at most 60 characters/);
  assert.equal(labelOption({ label: 'Boarding notice' }), 'Boarding notice');
  // Survives in both text and rows mode, same as region/priority/repeat.
  assert.equal(textOptions({ text: 'X', label: 'Gate' }).options.label, 'Gate');
  assert.equal(textOptions({ rows: ['AB'], label: 'Gate' }).options.label, 'Gate');
  // Not rejected alongside rows the way align/valign/wrap are - a name is
  // metadata, not layout, and applies to either shape the same way.
  assert.doesNotThrow(() => textOptions({ rows: ['AB'], label: 'Gate' }));
});

test('interrupt marks an item as an event, not a slide, and is strictly boolean', () => {
  assert.equal(interruptOption({}), undefined);
  for (const value of ['true', 1, 0, null]) {
    refused(() => interruptOption({ interrupt: value }), /interrupt must be true or false/);
  }
  assert.equal(interruptOption({ interrupt: true }), true);
  assert.equal(interruptOption({ interrupt: false }), false);
  assert.equal(textOptions({ text: 'X', interrupt: true }).options.interrupt, true);
  assert.equal(textOptions({ rows: ['AB'], interrupt: true }).options.interrupt, true);
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

test('screen is a shape, or null, and typos are refused', () => {
  assert.deepEqual(validateConfigPatch({ screen: { w: 16, h: 9 } }), { screen: { w: 16, h: 9 } });
  assert.deepEqual(validateConfigPatch({ screen: null }), { screen: null });
  // A typo that quietly does nothing is the worst outcome - same rule as regions.
  refused(() => validateConfigPatch({ screen: { w: 16, h: 9, ratio: 1.7 } }), /screen.ratio is not a screen field/);
  for (const bad of [{ w: 0, h: 9 }, { w: 16, h: -1 }, { w: 'wide', h: 9 }]) {
    refused(() => validateConfigPatch({ screen: bad }), /screen\.[wh] must be a positive number/);
  }
  refused(() => validateConfigPatch({ screen: [16, 9] }), /screen must be an object/);
});

test('ambient fidgeting is off, or slow enough to be ambient', () => {
  assert.deepEqual(validateConfigPatch({ ambientMs: 0 }), { ambientMs: 0 }, '0 is off');
  assert.deepEqual(validateConfigPatch({ ambientMs: 45000 }), { ambientMs: 45000 });
  // Fast enough to be a nuisance, or slow enough to be pointless, are both
  // refused: this is a board twitching now and then, not an animation.
  for (const bad of [100, 4999, 600001, null, 'often']) {
    refused(() => validateConfigPatch({ ambientMs: bad }), /ambientMs must be 0/);
  }
});

test('theme must be one this build ships', () => {
  refused(() => validateConfigPatch({ theme: 'tartan' }), new RegExp(`theme must be one of ${THEME_IDS.join(', ')}`));
  refused(() => validateConfigPatch({ theme: null }), /theme must be one of/);
  // The drawn twins' ids are aliases for reading old config, not values to write.
  refused(() => validateConfigPatch({ theme: 'classic-p' }), /theme must be one of/);
});

test('themePack: validated against the board\'s theme, stored sparse, sized as 413', () => {
  assert.deepEqual(validateConfigPatch({ themePack: null }), { themePack: null });
  // Identical to the preset: nothing to store.
  assert.deepEqual(validateConfigPatch({ themePack: { card: { fill: '#2b2b2b' } } }, { theme: 'classic' }), { themePack: null });
  // A real difference comes back sparse, other keys untouched.
  assert.deepEqual(
    validateConfigPatch({ cardSize: 'large', themePack: { card: { fill: '#ffffff', edge: '#000000' }, id: 'ignored' } }, { theme: 'classic' }),
    { cardSize: 'large', themePack: { card: { fill: '#ffffff' } } },
  );
  // Validated against the theme named in the same patch when there is one.
  assert.deepEqual(
    validateConfigPatch({ theme: 'canary', themePack: { card: { fill: '#139a04' } } }, { theme: 'classic' }),
    { theme: 'canary', themePack: null },
  );
  refused(() => validateConfigPatch({ themePack: [] }), /object or null/);
  refused(() => validateConfigPatch({ themePack: { card: { fill: 'nope' } } }), /card.fill/);
  refused(() => validateConfigPatch({ themePack: { art: { x: 'https://evil/x.png' }, states: { A: { art: 'x' } } } }), /root-relative/);
  refused(() => validateConfigPatch({ themeRev: 'abc' }), /set by the server/);
  try {
    validateConfigPatch({ themePack: { card: { fill: '#' + 'f'.repeat(70000) } } });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.status, 413);
  }
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

test('a grid is not a board setting, and saying so is the point', () => {
  /*
   * A board records the screen it is for and how big its cards are; how many
   * fit is worked out from those. Sending a grid is refused rather than
   * quietly dropped, so a caller that still thinks a board has one is told,
   * and told what to send instead.
   */
  refused(() => validateConfigPatch({ cols: 24 }), /cols is not a board setting/);
  refused(() => validateConfigPatch({ rows: 8 }), /rows is not a board setting/);
  refused(() => validateConfigPatch({ cols: 24 }), /screen.*cardSize/s);

  // And the two that are real.
  assert.deepEqual(validateConfigPatch({ cardSize: 'huge' }), { cardSize: 'huge' });
  refused(() => validateConfigPatch({ cardSize: 'enormous' }), /cardSize must be one of/);
  assert.deepEqual(validateConfigPatch({ screen: { w: 16, h: 9 } }), { screen: { w: 16, h: 9 } });
  // Any units, because only the ratio matters: a ticker given in centimetres
  // and the same ticker given as proportions are the same screen.
  assert.deepEqual(validateConfigPatch({ screen: { w: 300, h: 20 } }), { screen: { w: 300, h: 20 } });
  refused(() => validateConfigPatch({ screen: { w: 16, h: 0 } }), /screen.h must be a positive number/);
  refused(() => validateConfigPatch({ screen: { w: 16, h: 9, diagonalIn: 55 } }), /not a screen field/);
});

test('a saved interrupter needs a name and text; Duration is optional and one-or-the-other', () => {
  assert.deepEqual(validateInterrupterPreset({ name: 'FIRE', text: 'FIRE EVACUATE' }), {
    name: 'FIRE',
    text: 'FIRE EVACUATE',
  });
  assert.deepEqual(
    validateInterrupterPreset({ name: '  FIRE  ', text: 'X', durationMs: 60000 }),
    { name: 'FIRE', text: 'X', durationMs: 60000 },
    'name is trimmed',
  );
  refused(() => validateInterrupterPreset({ text: 'X' }), /name is required/);
  refused(() => validateInterrupterPreset({ name: '  ', text: 'X' }), /name is required/);
  refused(() => validateInterrupterPreset({ name: 'x'.repeat(61), text: 'X' }), /name is at most 60/);
  refused(() => validateInterrupterPreset({ name: 'FIRE' }), /text is required/);
  refused(() => validateInterrupterPreset({ name: 'FIRE', text: '  ' }), /text is required/);
  refused(
    () => validateInterrupterPreset({ name: 'FIRE', text: 'X', durationMs: 0 }),
    /durationMs must be a positive number/,
  );
  refused(
    () => validateInterrupterPreset({ name: 'FIRE', text: 'X', durationMs: -5 }),
    /durationMs must be a positive number/,
  );
  refused(
    () => validateInterrupterPreset({ name: 'FIRE', text: 'X', durationMs: 24 * 60 * 60 * 1000 + 1 }),
    /durationMs cannot exceed/,
  );
  assert.equal(
    validateInterrupterPreset({ name: 'FIRE', text: 'X', durationMs: 24 * 60 * 60 * 1000 }).durationMs,
    24 * 60 * 60 * 1000,
    'exactly the cap is fine',
  );

  // "reorder" collides with this board's own /interrupters/reorder route -
  // DELETE /interrupters/reorder would hit that static route (405) rather
  // than ever reaching deleteInterrupter, so a preset saved under that name
  // could be listed and fired but never removed. Refused up front instead,
  // case-insensitively like every other name comparison in this feature.
  refused(() => validateInterrupterPreset({ name: 'reorder', text: 'X' }), /"reorder" is reserved/);
  refused(() => validateInterrupterPreset({ name: 'Reorder', text: 'X' }), /"reorder" is reserved/);
  refused(() => validateInterrupterPreset({ name: '  REORDER  ', text: 'X' }), /"reorder" is reserved/);
});

test('a saved interrupter can carry align/valign, or rows instead of text - the same either-or textOptions itself has', () => {
  assert.deepEqual(validateInterrupterPreset({ name: 'FIRE', text: 'X', align: 'left', valign: 'top' }), {
    name: 'FIRE',
    text: 'X',
    align: 'left',
    valign: 'top',
  });
  refused(() => validateInterrupterPreset({ name: 'FIRE', text: 'X', align: 'diagonal' }), /align must be one of/);
  refused(() => validateInterrupterPreset({ name: 'FIRE', text: 'X', valign: 'center' }), /valign must be one of/);

  assert.deepEqual(validateInterrupterPreset({ name: 'FIRE', rows: ['ROW ONE', 'ROW TWO'] }), {
    name: 'FIRE',
    rows: ['ROW ONE', 'ROW TWO'],
  });
  // Neither text nor align/valign apply once rows is given - same reasoning
  // textOptions refuses them there too, rows are taken literally.
  refused(
    () => validateInterrupterPreset({ name: 'FIRE', rows: ['X'], text: 'Y' }),
    /text does not apply when rows is given/,
  );
  refused(
    () => validateInterrupterPreset({ name: 'FIRE', rows: ['X'], align: 'left' }),
    /align does not apply when rows is given/,
  );
  refused(
    () => validateInterrupterPreset({ name: 'FIRE', rows: ['X'], valign: 'top' }),
    /valign does not apply when rows is given/,
  );
  // A blank rows array is content-free the same way empty text is refused.
  refused(() => validateInterrupterPreset({ name: 'FIRE', rows: [] }), /rows must contain at least one/);
  refused(() => validateInterrupterPreset({ name: 'FIRE', rows: ['', '   '] }), /rows must contain at least one/);
  // Neither text nor rows at all is still refused, same as before.
  refused(() => validateInterrupterPreset({ name: 'FIRE' }), /text is required/);
  // wrap isn't silently dropped either, in either branch - a saved
  // interrupter has no wrap of its own yet, so a caller sending it is told
  // rather than having it vanish (caught in code review: this used to be
  // the one option textOptions validates/rejects that this didn't mirror).
  refused(() => validateInterrupterPreset({ name: 'FIRE', text: 'X', wrap: 'char' }), /wrap is not supported/);
  refused(() => validateInterrupterPreset({ name: 'FIRE', rows: ['X'], wrap: 'char' }), /wrap does not apply when rows is given/);
});
