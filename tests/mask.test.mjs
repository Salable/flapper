import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSecret, MASK } from '../lib/api/mask.mjs';

test('maskSecret hides every occurrence and nothing else', () => {
  const key = 'a'.repeat(64);
  const curl = `curl -H 'authorization: Bearer ${key}' https://x/b?key=${key}`;
  const masked = maskSecret(curl, key);
  assert.ok(!masked.includes(key));
  assert.equal(masked, `curl -H 'authorization: Bearer ${MASK}' https://x/b?key=${MASK}`);
  assert.equal(maskSecret('no key here', key), 'no key here');
});

test('maskSecret is inert for an empty or missing secret', () => {
  assert.equal(maskSecret('text', ''), 'text');
  assert.equal(maskSecret('text', undefined), 'text');
  assert.equal(maskSecret(undefined, 'k'), undefined);
});
