import test from 'node:test';
import assert from 'node:assert/strict';
import { ogCardData } from '../lib/board/og-card.mjs';

test('a grid is exactly the board`s own cols x rows', () => {
  const { cols, rows, grid } = ogCardData({
    name: 'Lobby',
    config: {},
    currentPayload: { text: 'WELCOME' },
  });
  assert.equal(grid.length, rows);
  for (const line of grid) assert.equal(line.length, cols);
});

test('an idle board (no currentPayload) shows its own name, not blank', () => {
  const { grid } = ogCardData({ name: 'Lobby', config: {}, currentPayload: null });
  assert.ok(grid.some((line) => line.includes('LOBBY')));
});

test('a blank message still falls back to the board`s name', () => {
  const { grid } = ogCardData({ name: 'Lobby', config: {}, currentPayload: { text: '   ' } });
  assert.ok(grid.some((line) => line.includes('LOBBY')));
});

test('rows-mode is taken literally, not re-wrapped', () => {
  const { grid, cols } = ogCardData({
    name: 'Sign',
    config: {},
    currentPayload: { rows: ['ROW ONE', 'ROW TWO'] },
  });
  assert.equal(grid[0].slice(0, 7), 'ROW ONE');
  assert.equal(grid[1].slice(0, 7), 'ROW TWO');
  assert.equal(grid[0].length, cols);
});

test('the pack comes from the board`s own theme, not a default stand-in', () => {
  const withTint = ogCardData({ name: 'X', config: { theme: 'classic' }, currentPayload: null });
  assert.equal(withTint.pack.id, 'classic');
});
