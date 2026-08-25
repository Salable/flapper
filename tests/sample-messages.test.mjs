import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_MESSAGES } from '../lib/board/sample-messages.mjs';
import { ringChars } from '../lib/board/ring.mjs';

test('SAMPLE_MESSAGES is frozen, non-empty, and more than one message', () => {
  // The whole reason there is more than one: a tile only moves forward
  // round the ring, so cycling between several messages is what shows a
  // design's flip at both a short travel and a long one - a single fixed
  // message never exercises that.
  assert.ok(Object.isFrozen(SAMPLE_MESSAGES));
  assert.ok(SAMPLE_MESSAGES.length > 1);
  for (const message of SAMPLE_MESSAGES) {
    assert.equal(typeof message, 'string');
    assert.notEqual(message.trim(), '');
  }
});

test('every character in every sample message is one the ring can actually show', () => {
  // Caught by hand-typing these: a stray character outside the ring's 42
  // states - a colon, a percent sign, a lowercase letter - would silently
  // substitute on a real board rather than error here, which defeats the
  // point of sample text meant to show a design exactly as it will look.
  const allowed = new Set([...ringChars(), '\n']);
  for (const message of SAMPLE_MESSAGES) {
    for (const char of message) {
      assert.ok(allowed.has(char), `"${char}" in ${JSON.stringify(message)} is not on the ring`);
    }
  }
});

test('at least one message spans three or more lines', () => {
  // Two-line messages alone never showed how a design's Card size, Sheen,
  // Vignette and hinge band read stacked five or six cards deep.
  const maxLines = Math.max(...SAMPLE_MESSAGES.map((message) => message.split('\n').length));
  assert.ok(maxLines >= 3, `longest message is only ${maxLines} line(s)`);
});
