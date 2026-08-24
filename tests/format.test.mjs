import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDay } from '../lib/format.ts';

/**
 * The whole point of this helper is that it does not vary, so that is what is
 * tested. It exists because `toLocaleDateString(undefined, ...)` gave
 * "Aug 24, 2026" from the server and "24 Aug 2026" in a British browser, and
 * React threw the settings page away on every load because of it.
 */

test('a day formats the same whatever the runtime locale is', () => {
  const when = Date.UTC(2026, 7, 24, 12, 0, 0);
  const expected = '24 Aug 2026';
  assert.equal(formatDay(when), expected);

  // The bug was a server and a browser disagreeing, which is this: the same
  // instant, formatted under a different default locale.
  const before = process.env.LANG;
  try {
    for (const locale of ['en_US.UTF-8', 'de_DE.UTF-8', 'C']) {
      process.env.LANG = locale;
      assert.equal(formatDay(when), expected, `LANG=${locale} changed the answer`);
    }
  } finally {
    if (before === undefined) delete process.env.LANG;
    else process.env.LANG = before;
  }
});

test('it takes a timestamp or a Date, and says the same thing', () => {
  const when = Date.UTC(2026, 0, 5, 9, 30);
  assert.equal(formatDay(when), formatDay(new Date(when)));
  assert.equal(formatDay(when), '05 Jan 2026');
});

test('the day is the UTC day, not the runtime time zone', () => {
  // 23:30 UTC on the 24th is the 25th in Sydney and still the 24th in London.
  // Pinning to UTC is what makes a created-on date a fact about the board
  // rather than a fact about who is looking at it.
  assert.equal(formatDay(Date.UTC(2026, 7, 24, 23, 30)), '24 Aug 2026');
  assert.equal(formatDay(Date.UTC(2026, 7, 25, 0, 30)), '25 Aug 2026');
});

test('every month gives the same shape, whatever its abbreviation', () => {
  // en-GB writes September as `Sept`, which is four letters where every other
  // month is three. That is correct British usage and it does not matter here,
  // because these dates sit in a definition list rather than a column - so what
  // is pinned is the shape, not a width.
  for (let month = 0; month < 12; month += 1) {
    const formatted = formatDay(Date.UTC(2026, month, 1));
    assert.match(formatted, /^\d{2} [A-Z][a-z]{2,4} \d{4}$/, formatted);
  }
  assert.equal(formatDay(Date.UTC(2026, 8, 1)), '01 Sept 2026', 'en-GB, not en-US');
});
