import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_KEY,
  AUDIO_DEFAULTS,
  CROWD_CEILING,
  FRAME_SPREAD_MS,
  MAX_VOICES_PER_FRAME,
  PAN_WIDTH,
  PITCH_JITTER,
  FlapSound,
  clampVolume,
  describeAudio,
  effectiveGain,
  nudgeVolume,
  normaliseAudioState,
  panForColumn,
  planVoices,
  readAudioState,
  toggleMute,
  writeAudioState,
} from '../lib/board/audio.mjs';

/* ---- volume state ---- */

test('volume clamps to 0..1 and rounds to a percent', () => {
  assert.equal(clampVolume(1.4), 1);
  assert.equal(clampVolume(-0.2), 0);
  assert.equal(clampVolume(0.333), 0.33);
  assert.equal(clampVolume('nope'), AUDIO_DEFAULTS.volume);
});

test('nudging up unmutes; nudging down keeps the flag and stops at zero', () => {
  const muted = { volume: 0.5, muted: true };
  assert.deepEqual(nudgeVolume(muted, 0.1), { volume: 0.6, muted: false });
  assert.deepEqual(nudgeVolume(muted, -0.1), { volume: 0.4, muted: true });
  assert.deepEqual(nudgeVolume({ volume: 0.05, muted: false }, -0.1), { volume: 0, muted: false });
  assert.deepEqual(nudgeVolume({ volume: 0.95, muted: false }, 0.1), { volume: 1, muted: false });
});

test('mute toggles and silences without losing the level', () => {
  const on = { volume: 0.6, muted: false };
  const off = toggleMute(on);
  assert.deepEqual(off, { volume: 0.6, muted: true });
  assert.equal(effectiveGain(off), 0);
  assert.equal(effectiveGain(toggleMute(off)), 0.36);
  assert.equal(describeAudio(off), 'Sound off');
  assert.equal(describeAudio(on), 'Volume 60%');
  assert.equal(describeAudio({ volume: 0, muted: false }), 'Volume 0%');
});

test('state round-trips through storage and survives garbage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(readAudioState(storage), { ...AUDIO_DEFAULTS });
  writeAudioState(storage, { volume: 0.3, muted: true });
  assert.deepEqual(readAudioState(storage), { volume: 0.3, muted: true });
  store.set(AUDIO_KEY, '{not json');
  assert.deepEqual(readAudioState(storage), { ...AUDIO_DEFAULTS });
  store.set(AUDIO_KEY, JSON.stringify({ volume: 7, muted: 'yes' }));
  assert.deepEqual(readAudioState(storage), { volume: 1, muted: true });
  assert.deepEqual(normaliseAudioState(null), { ...AUDIO_DEFAULTS });
  // No storage at all (SSR, sandboxed iframe) is not an error.
  assert.deepEqual(readAudioState(undefined), { ...AUDIO_DEFAULTS });
  writeAudioState(undefined, { volume: 1 });
});

/* ---- mixing ---- */

const fixedRandom = (value) => () => value;

test('one flap is one voice at unit gain, panned by its column', () => {
  const [voice, ...rest] = planVoices([{ col: 0 }], { cols: 20, samples: 16, random: fixedRandom(0) });
  assert.equal(rest.length, 0);
  assert.equal(voice.gain, 1);
  assert.equal(voice.delayMs, 0);
  assert.equal(voice.sample, 0);
  assert.equal(voice.pan, -PAN_WIDTH);
  assert.equal(voice.rate, 1 - PITCH_JITTER);
  assert.equal(panForColumn(19, 20), PAN_WIDTH);
  assert.equal(panForColumn(0, 1), 0);
  assert.ok(Math.abs(panForColumn(10, 21)) < 1e-9);
});

test('the stereo image is subtle: edges at PAN_WIDTH, the middle third near centre, symmetric', () => {
  assert.ok(PAN_WIDTH <= 0.4, 'a wall is listened to from the front; edges should drift, not throw');
  const cols = 21;
  const mid = panForColumn(10, cols);
  const third = panForColumn(13, cols); // a third of the way out from centre
  const edge = panForColumn(20, cols);
  assert.ok(Math.abs(mid) < 1e-9);
  assert.ok(Math.abs(third) < PAN_WIDTH * 0.2, `the middle third stays near centre, got ${third}`);
  assert.equal(edge, PAN_WIDTH);
  for (let col = 0; col < cols; col += 1) {
    assert.ok(Math.abs(panForColumn(col, cols) + panForColumn(cols - 1 - col, cols)) < 1e-9, 'mirror columns mirror');
    if (col > 0) assert.ok(panForColumn(col, cols) > panForColumn(col - 1, cols), 'monotonic left to right');
  }
});

test('a full-board sweep is capped in voices and in energy', () => {
  const flaps = Array.from({ length: 160 }, (_, i) => ({ col: i % 20 }));
  const plan = planVoices(flaps, { cols: 20, samples: 16, random: fixedRandom(0.5) });
  assert.equal(plan.length, MAX_VOICES_PER_FRAME);
  const energy = Math.sqrt(plan.reduce((sum, v) => sum + v.gain * v.gain, 0));
  assert.ok(energy <= CROWD_CEILING + 1e-9, `summed amplitude ${energy} over the ceiling`);
  assert.ok(energy > 1, 'a crowd should be louder than one tile');
  for (const voice of plan) {
    assert.ok(voice.delayMs >= 0 && voice.delayMs < FRAME_SPREAD_MS);
    assert.ok(voice.sample >= 0 && voice.sample < 16);
    assert.ok(Math.abs(voice.pan) <= PAN_WIDTH);
  }
  // The voices are spread through the frame, not stacked at zero.
  const delays = plan.map((v) => v.delayMs);
  assert.ok(new Set(delays).size === delays.length);
});

test('energy grows with the crowd and then plateaus', () => {
  const energy = (n) => {
    const plan = planVoices(
      Array.from({ length: n }, (_, i) => ({ col: i % 20 })),
      { cols: 20, samples: 16, random: fixedRandom(0.5) },
    );
    return Math.sqrt(plan.reduce((sum, v) => sum + v.gain * v.gain, 0));
  };
  assert.ok(energy(1) < energy(4));
  assert.ok(energy(4) < energy(8));
  assert.ok(Math.abs(energy(40) - energy(160)) < 1e-9);
});

test('when more tiles flip than voices, the picked ones trace the sweep', () => {
  // A column sweep: every flap in this frame is in column 3 then column 4.
  const flaps = [...Array(8).fill({ col: 0 }), ...Array(8).fill({ col: 19 })];
  const plan = planVoices(flaps, { cols: 20, samples: 16, random: fixedRandom(0), maxVoices: 4 });
  assert.deepEqual(
    plan.map((v) => v.pan),
    [-PAN_WIDTH, -PAN_WIDTH, PAN_WIDTH, PAN_WIDTH],
  );
});

test('nothing to voice is an empty plan', () => {
  assert.deepEqual(planVoices([], { cols: 20, samples: 16 }), []);
  assert.deepEqual(planVoices([{ col: 1 }], { cols: 20, samples: 0 }), []);
});

/* ---- the Web Audio shell, against a fake context ---- */

function fakeContext() {
  const started = [];
  const param = (value = 0) => ({
    value,
    cancelScheduledValues() {},
    setTargetAtTime(v) {
      this.value = v;
    },
  });
  const node = (extra = {}) => ({ connect() {}, ...extra });
  const ctx = {
    state: 'suspended',
    currentTime: 1,
    destination: node(),
    started,
    createGain: () => node({ gain: param(1) }),
    createDynamicsCompressor: () =>
      node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createStereoPanner: () => node({ pan: param() }),
    createBufferSource: () =>
      node({
        playbackRate: param(1),
        start(when, offset, duration) {
          started.push({ when, offset, duration, rate: this.playbackRate.value });
        },
      }),
    decodeAudioData: async () => ({ duration: 1.4 }),
    resume: async () => {
      ctx.state = 'running';
    },
    close: async () => {
      ctx.state = 'closed';
    },
  };
  return ctx;
}

function fakeFetch() {
  return async (url) => {
    if (url.endsWith('manifest.json')) {
      return {
        ok: true,
        json: async () => ({
          sampleRate: 24000,
          file: 'flap.wav',
          samples: [
            { offset: 0, duration: 0.088 },
            { offset: 0.088, duration: 0.088 },
          ],
        }),
      };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
}

test('FlapSound is silent until loaded and unlocked, then voices a board flap', async () => {
  const ctx = fakeContext();
  const sound = new FlapSound({ createContext: () => ctx, random: fixedRandom(0.25) });
  const board = { onFlap: null };
  sound.attach(board);
  assert.equal(typeof board.onFlap, 'function');

  // Not loaded: a flap is swallowed, not an exception.
  assert.equal(board.onFlap([{ index: 0, col: 0 }], 20), 0);
  await sound.load(fakeFetch());
  // Loaded but the browser has not had a gesture yet.
  assert.equal(sound.unlocked, false);
  assert.equal(board.onFlap([{ index: 0, col: 0 }], 20), 0);

  assert.equal(await sound.unlock(), true);
  assert.equal(board.onFlap([{ index: 0, col: 0 }, { index: 21, col: 1 }], 20), 2);
  assert.equal(ctx.started.length, 2);
  assert.ok(ctx.started[0].when >= 1 && ctx.started[0].when < 1 + FRAME_SPREAD_MS / 1000);
  assert.equal(ctx.started[0].offset, 0);
  assert.equal(ctx.started[0].duration, 0.088);
  assert.ok(ctx.started[1].when > ctx.started[0].when, 'voices spread through the frame');

  // Muted: the master drops to zero and flaps stop scheduling work at all.
  sound.setState({ volume: 0.6, muted: true });
  assert.equal(sound.master.gain.value, 0);
  assert.equal(board.onFlap([{ index: 0, col: 0 }], 20), 0);
  sound.setState({ volume: 0.5, muted: false });
  assert.equal(sound.master.gain.value, 0.25);

  sound.stop();
  assert.equal(board.onFlap, null, 'detached on stop');
  assert.equal(ctx.state, 'closed');
});

test('attach replaces a previous board without leaking its hook', () => {
  const sound = new FlapSound({ createContext: fakeContext });
  const a = { onFlap: null };
  const b = { onFlap: null };
  sound.attach(a);
  sound.attach(b);
  assert.equal(a.onFlap, null);
  assert.equal(typeof b.onFlap, 'function');
  sound.stop();
});
