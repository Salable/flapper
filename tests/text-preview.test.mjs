import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewClip } from '../lib/board/text-preview.mjs';

test('short text passes through unchanged', () => {
  assert.equal(previewClip('HELLO'), 'HELLO');
});

test('long text clips back to the last whole word, not mid-word', () => {
  const long = 'ASDASDASD ASD ASDASD SDA DASD ASD SDA SD DSAD ASD ASD DS NND HAND';
  const clipped = previewClip(long, 38);
  assert.ok(clipped.endsWith('…'));
  // The character right before the ellipsis is never mid-word: it's either
  // the end of the source string or immediately follows a space in it.
  const withoutEllipsis = clipped.slice(0, -1);
  assert.ok(long.startsWith(withoutEllipsis));
  const nextChar = long[withoutEllipsis.length];
  assert.ok(nextChar === undefined || nextChar === ' ');
});

test('a single word longer than max has nothing to break on, so it is cut as-is', () => {
  const long = 'A'.repeat(60);
  const clipped = previewClip(long, 10);
  assert.equal(clipped, `${'A'.repeat(10)}…`);
});

test('trims surrounding whitespace before measuring', () => {
  assert.equal(previewClip('   HELLO   '), 'HELLO');
});
