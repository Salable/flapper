import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './stub-board.mjs';
import { Player } from '../lib/board/player.mjs';

/**
 * The queue player's state machine, run against the stub board (real
 * Controller, real layout) and a hand-rolled API fake, under mock timers.
 */

const DWELL = 1000;
const drain = () => new Promise((resolve) => setImmediate(resolve));

const item = (id, text, extra = {}) => ({
  id,
  payload: { text, options: {} },
  loop: false,
  updatedAt: 1,
  ...extra,
});

const playingSnap = (current, items, epoch = 1, extra = {}) => ({
  currentItemId: current,
  currentState: 'playing',
  epoch,
  queueUpdatedAt: epoch,
  items,
  config: null,
  ...extra,
});

function fakeApi() {
  const api = {
    fetches: [],
    advances: [],
    advanceResults: [],
    fetchQueue: async () => {
      const next = api.fetches.length > 1 ? api.fetches.shift() : api.fetches[0];
      if (!next) throw new Error('no snapshot scripted');
      return next;
    },
    advance: async (itemId, epoch, error) => {
      api.advances.push({ itemId, epoch, error });
      const result = api.advanceResults.shift();
      if (!result) throw new Error('no advance scripted');
      return result;
    },
  };
  return api;
}

function makePlayer(t, api, hooks) {
  const { board, controller } = setup(t, 20, 1);
  const player = new Player(controller, board, api, hooks);
  return { board, controller, player };
}

/** Settle the glass, serve the dwell, and let async completions run. */
async function finishCurrent(board) {
  board.settle();
  await drain();
  mock.timers.tick(DWELL);
  await drain();
  await drain();
}

test('plays the current item, advances on completion, plays the next', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'AAA'), item('b', 'BBB')]));
  api.advanceResults.push({ advanced: true, current: item('b', 'BBB'), currentState: 'playing', epoch: 2 });
  const { board, player } = makePlayer(t, api);

  await player.start();
  assert.equal(board.shown.at(-1).trim(), 'AAA');

  await finishCurrent(board);
  assert.deepEqual(api.advances, [{ itemId: 'a', epoch: 1, error: undefined }]);
  assert.equal(board.shown.at(-1).trim(), 'BBB');
  assert.equal(player.epoch, 2);
});

test('holding: our own finish keeps the page; no phantom advance follows', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'LAST')]));
  api.advanceResults.push({ advanced: true, current: item('a', 'LAST'), currentState: 'holding', epoch: 2 });
  const { board, player } = makePlayer(t, api);

  await player.start();
  await finishCurrent(board);
  assert.equal(api.advances.length, 1);
  assert.equal(player.playing.held, true);
  assert.equal(board.shown.at(-1).trim(), 'LAST');

  // Nothing else fires: held pages do not complete again.
  mock.timers.tick(60000);
  await drain();
  assert.equal(api.advances.length, 1);
});

test('a clear is not a completion: the glass blanks and no advance is reported', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'AAA')]));
  const { board, controller, player } = makePlayer(t, api);
  await player.start();

  api.fetches.length = 0;
  api.fetches.push({ currentItemId: null, currentState: 'idle', epoch: 2, queueUpdatedAt: 2, items: [] });
  await player.onClear();
  await drain();
  assert.equal(api.advances.length, 0);
  assert.equal(controller.status().showing, null);
  assert.equal(board.shown.at(-1).trim(), '');
});

test('a sync naming a different current cuts over without replaying the old item later', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'OLD'), item('b', 'NEW')]));
  const { board, controller, player } = makePlayer(t, api);
  await player.start();
  assert.equal(board.shown.at(-1).trim(), 'OLD');

  api.fetches.length = 0;
  api.fetches.push(playingSnap('b', [item('b', 'NEW')], 2));
  await player.onSync({ currentItemId: 'b', epoch: 2, queueUpdatedAt: 2 });
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'NEW');
  // The displaced OLD must not be waiting in the local track.
  assert.equal(controller.queue.length, 0);

  // Finishing NEW advances NEW, not OLD.
  api.advanceResults.push({ advanced: true, current: null, currentState: 'idle', epoch: 3 });
  await finishCurrent(board);
  assert.equal(api.advances.at(-1).itemId, 'b');
});

test('an edited current item (updatedAt moved) restarts from page 0', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'BEFORE')]));
  const { board, player } = makePlayer(t, api);
  await player.start();

  api.fetches.length = 0;
  api.fetches.push(playingSnap('a', [{ ...item('a', 'AFTER'), updatedAt: 2 }], 1, { queueUpdatedAt: 5 }));
  await player.onSync({ currentItemId: 'a', epoch: 1, queueUpdatedAt: 5 });
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'AFTER');
});

test('a matching sync payload skips the refetch entirely', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'AAA')]));
  const { player } = makePlayer(t, api);
  await player.start();

  api.fetches.length = 0; // any fetch now would throw
  const result = await player.onSync({ currentItemId: 'a', epoch: 1, queueUpdatedAt: 1 });
  assert.equal(result, null);
});

test('holding cold-start paints the last page immediately, without animation', async (t) => {
  const api = fakeApi();
  api.fetches.push({
    currentItemId: 'h',
    currentState: 'holding',
    epoch: 4,
    queueUpdatedAt: 4,
    items: [item('h', 'STANDING')],
    config: null,
  });
  const { board, player } = makePlayer(t, api);
  await player.start();
  assert.equal(board.shown.at(-1).trim(), 'STANDING');
  assert.equal(board.isAnimating('main'), false);
  assert.equal(player.playing.held, true);
  assert.equal(api.advances.length, 0);
});

test('a poison item is reported as an errored play and the queue moves on', async (t) => {
  const api = fakeApi();
  const poison = { id: 'p', payload: { text: 'X', options: { region: 'nowhere' } }, loop: false, updatedAt: 1 };
  api.fetches.push(playingSnap('p', [poison, item('b', 'GOOD')]));
  api.advanceResults.push({ advanced: true, current: item('b', 'GOOD'), currentState: 'playing', epoch: 2 });
  const notes = [];
  const { board, player } = makePlayer(t, api, { onNote: (note) => notes.push(note) });

  await player.start();
  await drain();
  assert.equal(api.advances.length, 1);
  assert.equal(api.advances[0].itemId, 'p');
  assert.ok(api.advances[0].error);
  assert.ok(notes.some((note) => /unplayable/i.test(note)));
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'GOOD');
});

test('panic blanks and holds the blank until the queue actually changes', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'AAA')]));
  const { board, controller, player } = makePlayer(t, api);
  await player.start();

  player.panicBlank();
  assert.equal(controller.status().showing, null);

  // Unchanged content: the blank stands.
  await player.onSync(); // forces a refetch of the same snapshot
  assert.equal(board.shown.at(-1).trim(), '');

  // A loop advancing on its own bumps the epoch but not the content: the
  // blank still stands - a panic the loop lifts is no panic at all.
  api.fetches.length = 0;
  api.fetches.push(playingSnap('a', [item('a', 'AAA')], 7));
  await player.onSync({ currentItemId: 'a', epoch: 7, queueUpdatedAt: 7 });
  assert.equal(board.shown.at(-1).trim(), '');

  // Someone edits or adds a message: playback resumes.
  api.fetches.length = 0;
  api.fetches.push(playingSnap('a', [{ ...item('a', 'AAA'), updatedAt: 9 }], 8));
  await player.onSync({ currentItemId: 'a', epoch: 8, queueUpdatedAt: 9 });
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'AAA');
});

test('config in the snapshot reaches the config hook', async (t) => {
  const api = fakeApi();
  api.fetches.push(playingSnap('a', [item('a', 'AAA')], 1, { config: { cols: 30 }, themeRev: 'abc' }));
  const configs = [];
  const { player } = makePlayer(t, api, { onConfig: (config, meta) => configs.push([config, meta]) });
  await player.start();
  assert.deepEqual(configs, [[{ cols: 30 }, { themeRev: 'abc' }]]);
});

/* ---- clock playback ---- */

const clockSnap = (items, config, serverNowMs, extra = {}) => ({
  playback: 'clock',
  type: 'scheduled',
  paused: false,
  currentItemId: null,
  currentState: 'idle',
  epoch: 0,
  queueUpdatedAt: 1,
  serverNowMs,
  items,
  config,
  ...extra,
});

function clockPlayer(t, api) {
  const timers = [];
  const { board, controller } = setup(t, 20, 1);
  const player = new Player(controller, board, api, {
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
  });
  return { board, controller, player, timers };
}

test('clock: shows the active item and sleeps until the next change', async (t) => {
  const now = Date.now();
  const api = fakeApi();
  api.fetches.push(
    clockSnap(
      [
        {
          ...item('slot', 'OPEN'),
          schedule: { kind: 'once', atMs: now - 1000, durationMs: 60_000 },
          createdAt: now - 1000,
          computedDurationMs: 3000,
        },
      ],
      { timezone: 'UTC', fallback: 'STAND BY' },
      now,
    ),
  );
  const { board, player, timers } = clockPlayer(t, api);
  await player.start();
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'OPEN');
  // The next change is the slot's end, ~59s out; the tick sleeps until then.
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms > 55_000 && timers[0].ms <= 60_000, `slept ${timers[0].ms}`);
  // No advance reporting on a clock board: the clock is the authority.
  assert.equal(api.advances.length, 0);
});

test('clock: an empty schedule stands on the fallback message', async (t) => {
  const now = Date.now();
  const api = fakeApi();
  api.fetches.push(clockSnap([], { timezone: 'UTC', fallback: 'STAND BY' }, now));
  const { board, player, timers } = clockPlayer(t, api);
  await player.start();
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'STAND BY');
  // Nothing scheduled: nothing to wake for until the next nudge.
  assert.equal(timers.length, 0);
});

test('clock: panic holds the blank through ticks until the schedule changes', async (t) => {
  const now = Date.now();
  const api = fakeApi();
  const slotted = clockSnap(
    [
      {
        ...item('slot', 'OPEN'),
        schedule: { kind: 'once', atMs: now - 1000, durationMs: 600_000 },
        createdAt: now - 1000,
        computedDurationMs: 3000,
      },
    ],
    { timezone: 'UTC' },
    now,
  );
  api.fetches.push(slotted);
  const { board, player } = clockPlayer(t, api);
  await player.start();
  board.settle();
  assert.equal(board.shown.at(-1).trim(), 'OPEN');

  player.panicBlank();
  assert.equal(player.playing, null);
  // A resync with the same content keeps the panic; the glass stays dark.
  await player.onSync(undefined);
  assert.equal(player.playing, null);
});
