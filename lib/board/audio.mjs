/**
 * The sound of the board.
 *
 * Every time a tile steps one state the renderer reports a flap
 * (`Flipboard.onFlap`), and this module answers with a clack: one of the
 * single-flap samples cut from a recording of a real board
 * (tools/build_audio.py), fired through Web Audio. The design is additive
 * and per tile, not a loop: a lone tile correcting itself is one click, a
 * full-board sweep is a hundred and sixty of them, and what you hear is the
 * sum - panned across the stereo field by column, each at a slightly
 * different pitch, so the board sounds like a machine rather than a sample.
 *
 * The sum has to be tamed or a sweep would clip: `planVoices` caps how many
 * voices a single frame may start, scales each so the total grows with the
 * crowd but plateaus, and spreads them across the frame so they do not
 * phase-stack into one loud click. Those decisions are pure and tested; the
 * AudioContext binding at the bottom is a thin shell around them.
 *
 * Mute and volume are the display's own, not the board's: a kiosk in a quiet
 * office and one in a foyer can show the same board at different levels. They
 * persist per browser in localStorage.
 */

export const AUDIO_KEY = 'flapper.audio.v1';
export const AUDIO_DEFAULTS = Object.freeze({ volume: 0.6, muted: false });
export const VOLUME_STEP = 0.1;

/** Voices one animation frame may start. Past this, more flaps raise the level, not the count. */
export const MAX_VOICES_PER_FRAME = 8;
/** Window the frame's voices are spread across, ms - a shade under a 60Hz frame. */
export const FRAME_SPREAD_MS = 14;
/** How much louder than one tile a crowd of them may get (amplitude). */
export const CROWD_CEILING = 1.6;
/** Per-voice pitch spread, ±fraction of playback rate. */
export const PITCH_JITTER = 0.07;
/** Leftmost and rightmost columns pan this far out, -1..1. */
export const PAN_WIDTH = 0.7;

/* ---- volume state: pure ---- */

export function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return AUDIO_DEFAULTS.volume;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** Normalise anything read from storage into a well-formed state. */
export function normaliseAudioState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    volume: clampVolume('volume' in source ? source.volume : AUDIO_DEFAULTS.volume),
    muted: Boolean(source.muted),
  };
}

/**
 * Step the volume. Turning it up while muted unmutes - reaching for the
 * volume key means you want to hear it - and turning it down to zero is
 * silence by level, not by flag, so the next press up brings it back.
 */
export function nudgeVolume(state, delta) {
  const volume = clampVolume(state.volume + delta);
  return { volume, muted: delta > 0 ? false : state.muted };
}

export function toggleMute(state) {
  return { ...state, muted: !state.muted };
}

/** The level a state produces, 0..1. Squared: the slider feels even to the ear. */
export function effectiveGain(state) {
  return state.muted ? 0 : state.volume * state.volume;
}

/** One-line description for the on-screen toast. */
export function describeAudio(state) {
  if (state.muted) return 'Sound off';
  if (state.volume === 0) return 'Volume 0%';
  return `Volume ${Math.round(state.volume * 100)}%`;
}

export function readAudioState(storage) {
  try {
    const raw = storage?.getItem(AUDIO_KEY);
    return normaliseAudioState(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...AUDIO_DEFAULTS };
  }
}

export function writeAudioState(storage, state) {
  try {
    storage?.setItem(AUDIO_KEY, JSON.stringify(normaliseAudioState(state)));
  } catch {
    /* private mode, quota - the setting just does not survive a reload */
  }
}

/* ---- mixing: pure ---- */

/**
 * Stereo position for a column: -PAN_WIDTH at the left edge, +PAN_WIDTH at
 * the right, 0 for a one-column board.
 */
export function panForColumn(col, cols) {
  if (cols <= 1) return 0;
  return ((col / (cols - 1)) * 2 - 1) * PAN_WIDTH;
}

/**
 * Decide how the flaps of one frame are voiced.
 *
 * @param {{col:number}[]} flaps tiles that stepped this frame
 * @param {{cols:number, samples:number, random?:()=>number, maxVoices?:number}} options
 * @returns {{sample:number, gain:number, delayMs:number, pan:number, rate:number}[]}
 *
 * Properties the tests pin down: one flap is one voice at unit gain; the voice
 * count never exceeds the cap; the summed energy grows with the crowd but
 * never past CROWD_CEILING; voices are spread through the frame window; pans
 * follow the columns actually flipping, so a sweep travels across the room.
 */
export function planVoices(flaps, { cols, samples, random = Math.random, maxVoices = MAX_VOICES_PER_FRAME }) {
  const count = flaps.length;
  if (count === 0 || samples <= 0) return [];
  const voices = Math.min(count, maxVoices);
  // Perceived total: one tile is 1, each extra adds a little, capped.
  const crowd = Math.min(CROWD_CEILING, 1 + 0.08 * (count - 1));
  // Uncorrelated voices sum in power, so divide amplitude by sqrt(n) to land
  // the crowd where we want it.
  const gain = crowd / Math.sqrt(voices);

  // Which flaps get voiced when there are more than the cap: an even spread
  // through the list, so the pan positions still trace the sweep.
  const picked = [];
  for (let i = 0; i < voices; i += 1) {
    picked.push(flaps[Math.floor((i * count) / voices)]);
  }

  const slot = FRAME_SPREAD_MS / voices;
  return picked.map((flap, i) => ({
    sample: Math.floor(random() * samples) % samples,
    gain,
    delayMs: i * slot + random() * slot * 0.8,
    pan: panForColumn(flap.col, cols),
    rate: 1 + (random() * 2 - 1) * PITCH_JITTER,
  }));
}

/* ---- Web Audio binding ---- */

/**
 * Plays flaps. Construct once per display, `load()` the sprite, `attach()` a
 * Flipboard, and feed it `setState()` as the keys change.
 *
 * Browsers refuse to start audio until the page has had a user gesture; the
 * context sits suspended until `unlock()` is called from one (the display
 * calls it from the first keydown or pointerdown). `unlocked` says where it
 * stands so the page can tell the user.
 */
export class FlapSound {
  /**
   * @param {{state?:object, random?:()=>number, createContext?:()=>AudioContext, base?:string}} [options]
   */
  constructor({ state = AUDIO_DEFAULTS, random = Math.random, createContext, base = '/audio' } = {}) {
    this.state = normaliseAudioState(state);
    this.random = random;
    this.base = base;
    this.createContext = createContext ?? (() => new (globalThis.AudioContext || globalThis.webkitAudioContext)());
    this.ctx = null;
    this.master = null;
    this.buffer = null;
    this.samples = [];
    this.board = null;
    this.detach = null;
  }

  /** Lazily build the context and the master chain. Safe before a gesture. */
  context() {
    if (this.ctx) return this.ctx;
    const ctx = this.createContext();
    const master = ctx.createGain();
    master.gain.value = effectiveGain(this.state);
    // A limiter on the sum: the planner keeps a sweep in bounds, the
    // compressor catches the rest, and a loud room never hears a clipped one.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** Fetch and decode the sprite. Resolves when the board can make a sound. */
  async load(fetchImpl = globalThis.fetch) {
    const ctx = this.context();
    const manifest = await (await fetchImpl(`${this.base}/manifest.json`)).json();
    const response = await fetchImpl(`${this.base}/${manifest.file}`);
    if (!response.ok) throw new Error(`${manifest.file}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(bytes);
    this.samples = manifest.samples;
    return this;
  }

  get unlocked() {
    return this.ctx?.state === 'running';
  }

  /** Call from inside a user gesture. Idempotent. */
  async unlock() {
    const ctx = this.context();
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* not a gesture after all; the next one will do it */
      }
    }
    return this.unlocked;
  }

  /** Listen to a Flipboard. Replaces any board attached before. */
  attach(board) {
    this.detach?.();
    this.board = board;
    const previous = board.onFlap;
    board.onFlap = (flaps, cols) => this.play(flaps, cols);
    this.detach = () => {
      if (board.onFlap !== previous) board.onFlap = previous;
      this.board = null;
      this.detach = null;
    };
    return this;
  }

  setState(state) {
    this.state = normaliseAudioState(state);
    if (this.master) {
      // A short ramp, so a volume key press never clicks in itself.
      const { gain } = this.master;
      const now = this.ctx.currentTime;
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(effectiveGain(this.state), now, 0.02);
    }
    return this.state;
  }

  /** Voice one frame's flaps. Silent until loaded, unlocked and audible. */
  play(flaps, cols) {
    if (!this.buffer || !this.unlocked || effectiveGain(this.state) === 0) return 0;
    const plan = planVoices(flaps, { cols, samples: this.samples.length, random: this.random });
    const ctx = this.ctx;
    const at = ctx.currentTime;
    for (const voice of plan) {
      const sample = this.samples[voice.sample];
      const source = ctx.createBufferSource();
      source.buffer = this.buffer;
      source.playbackRate.value = voice.rate;
      const gain = ctx.createGain();
      gain.gain.value = voice.gain;
      let tail = gain;
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = voice.pan;
        gain.connect(panner);
        tail = panner;
      }
      source.connect(gain);
      tail.connect(this.master);
      source.start(at + voice.delayMs / 1000, sample.offset, sample.duration);
    }
    return plan.length;
  }

  /** Release the audio hardware. */
  stop() {
    this.detach?.();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    ctx?.close?.().catch?.(() => {});
  }
}
