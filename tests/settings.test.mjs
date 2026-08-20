import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, defaultSettings, SETTINGS_KEY } from '../lib/board/settings.mjs';

/** A Storage stand-in: just the two methods the modules use. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

test('defaults come back untouched when nothing is stored', () => {
  const settings = loadSettings(fakeStorage());
  assert.deepEqual(settings, defaultSettings());
  assert.equal(settings.cols, 20);
  assert.equal(settings.rows, 8);
});

test('stored values shadow defaults one level deep', () => {
  const storage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ cols: 44, playlist: 'HI' }) });
  const settings = loadSettings(storage);
  assert.equal(settings.cols, 44);
  assert.equal(settings.playlist, 'HI');
  assert.equal(settings.rows, defaultSettings().rows);
});

test('corrupt storage is treated as empty, not fatal', () => {
  assert.deepEqual(loadSettings(fakeStorage({ [SETTINGS_KEY]: '{oops' })), defaultSettings());
  assert.deepEqual(loadSettings(undefined), defaultSettings());
});

test('save and load round-trip', () => {
  const storage = fakeStorage();
  saveSettings(storage, { ...defaultSettings(), sweepMs: 725 });
  assert.equal(loadSettings(storage).sweepMs, 725);
});

test('a throwing storage is swallowed on save', () => {
  saveSettings({ setItem: () => { throw new Error('quota'); } }, defaultSettings());
});

