import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import settings from '../src/main/settings.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flapper-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('defaults to local only when nothing is saved', (t) => {
  assert.deepEqual(settings.load(tempDir(t)), { publicAccess: false });
});

test('public access round-trips', (t) => {
  const dir = tempDir(t);
  assert.equal(settings.savePublicAccess(dir, true), true);
  assert.equal(settings.load(dir).publicAccess, true);
  settings.savePublicAccess(dir, false);
  assert.equal(settings.load(dir).publicAccess, false);
});

test('a corrupt file recovers rather than throwing', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(settings.filePath(dir), 'not json at all');
  assert.deepEqual(settings.load(dir), { publicAccess: false });
});

test('an unexpected shape recovers rather than throwing', (t) => {
  const dir = tempDir(t);
  for (const body of ['[1,2,3]', '"a string"', 'null', '{"publicAccess":"yes"}']) {
    fs.writeFileSync(settings.filePath(dir), body);
    assert.equal(settings.load(dir).publicAccess, false, body);
  }
});

test('saving creates the directory if needed', (t) => {
  const dir = path.join(tempDir(t), 'nested', 'deeper');
  assert.equal(settings.savePublicAccess(dir, true), true);
  assert.equal(settings.load(dir).publicAccess, true);
});
