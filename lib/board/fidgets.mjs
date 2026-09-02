/**
 * What a board does while it holds still.
 *
 * This is the second model. The first grew a field for every note Dan gave
 * while we watched it - sweepEvery, restOdds, flickerCount, stepDistance,
 * holdMs, stepMs, returnStepMs, cardWash, washGlyphs, vanishHome,
 * shortestPath - eleven of them, several meaningless alone, and at least one
 * bug (a colour gesture showing random letters) caused by two of them
 * combining into a behaviour neither described. That is sediment.
 *
 * Dan's model is four things, one of which is a list:
 *
 *   how often  ·  how many cards at once  ·  how long each beat  ·  the beats
 *
 * The list is the timeline. Its length is the length of the gesture, so
 * there is no count to keep in step with it and no way for a fidget to
 * disagree with itself.
 *
 * Two rules are definitions rather than settings, and so are not fields:
 *
 *   - **Position is always random.** A fidget lands on any card of the grid,
 *     blank ones included. Nothing chooses where. (A creature that walks the
 *     border therefore is not a fidget - see travellers.mjs, which is the
 *     seed of a separate feature.)
 *   - **How the card gets back is the engine's problem.** Direction, step
 *     timing, whether it turns round or finishes the lap: all consequences,
 *     none of them an author's decision. Every one of those was a field in
 *     the first model and every one of them caused trouble.
 *
 * Pure: a fidget is data, and this file only describes and validates it.
 * ambient.ts runs it against a real board.
 */

/**
 * A beat: one entry in a fidget's list, one thing a card shows.
 *
 * Three kinds and no more:
 *
 *   - `colour` - the card is baked in that colour, and carries no letter. A
 *     card wearing a colour has nothing to say.
 *   - `house`  - the design's own card, showing a character. Which character
 *     is not the author's business; it is a fidget, not a message.
 *   - `origin` - back to whatever the card was showing before the fidget
 *     started. This is what makes ping-pong a thing you write rather than a
 *     feature: `[colour, origin, colour, origin]` is a card blinking.
 */
export const BEAT_KINDS = Object.freeze(['colour', 'house', 'origin']);

/** A colour beat. */
export const colour = (hex) => Object.freeze({ kind: 'colour', colour: hex });
/** A house-style beat: the design's own card, some character on it. */
export const house = () => Object.freeze({ kind: 'house' });
/** Back to what the card was showing. */
export const origin = () => Object.freeze({ kind: 'origin' });

/**
 * The shape of a fidget, and the defaults a new one starts from.
 *
 * `beatMs` is deliberately slower than anything the first model shipped.
 * Watching all eleven of those together, Dan's note was that they "all seem
 * to be a little fast" - and they were, because each one had been tuned
 * against the flip speed of a board delivering a message (55ms a step)
 * rather than against a room someone is sitting in.
 */
export const FIDGET_DEFAULTS = Object.freeze({
  /** Roughly how often it happens, in ms. */
  everyMs: 14000,
  /**
   * How much that varies, in ms, either way.
   *
   * A fidget on an exact metronome stops reading as a board idling and
   * starts reading as a clock, which is the one thing it must not be.
   */
  varyMs: 5000,
  /** How many cards do it at once. */
  cards: 1,
  /** How long one beat lasts, in ms - the flip and the pause together. */
  beatMs: 620,
  /** The timeline. Its length is the length of the gesture. */
  beats: Object.freeze([house()]),
});

/** A fidget from a partial description, filled in from the defaults. */
export function fidget(spec = {}) {
  return Object.freeze({ ...FIDGET_DEFAULTS, ...spec });
}

/**
 * How long one run of `f` takes, start to finish.
 *
 * The number the designer should show while you add beats to the list: it is
 * the whole reason a cap on list length is unnecessary. Nobody adds a
 * twentieth colour once they can see it makes a twelve-second gesture.
 */
export function runMs(f) {
  return f.beats.length * f.beatMs;
}

/**
 * The interval before the next run, given a tick counter.
 *
 * Deterministic, like everything else here, so a sequence can be tested: the
 * variance is a hash of the tick rather than Math.random.
 */
export function nextGapMs(f, tick) {
  if (f.varyMs <= 0) return f.everyMs;
  let x = ((tick | 0) + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  const roll = ((x ^ (x >>> 15)) >>> 0) / 0xffffffff;
  return Math.max(1000, Math.round(f.everyMs + (roll * 2 - 1) * f.varyMs));
}

/**
 * Which cards this run happens to: `cards` distinct positions, at random,
 * anywhere on the grid.
 *
 * Deterministic in `tick` for the same reason as everything else. Blank
 * cards are eligible - that is the rule, not an option - so this needs
 * nothing but the size of the grid.
 */
export function pickCells(f, cellCount, tick) {
  if (cellCount <= 0) return [];
  const want = Math.min(f.cards, cellCount);
  const out = [];
  const taken = new Set();
  for (let n = 0; out.length < want && n < want * 12; n += 1) {
    let x = ((tick * 31 + n * 7 + 0x9e3779b9) | 0);
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    const index = ((x ^ (x >>> 15)) >>> 0) % cellCount;
    if (taken.has(index)) continue;
    taken.add(index);
    out.push(index);
  }
  return out;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Long enough for any gesture anybody wants; short enough to stay a gesture. */
const MAX_BEATS = 32;

/**
 * The fidgets that ship.
 *
 * Every one is four numbers and a list. Read them as sentences: pina colada
 * is "one card, three colours, two thirds of a second each, now and then".
 */
export const FIDGETS = Object.freeze({
  /** A card turns over and is back. The quietest thing the board does. */
  tick: fidget({ beats: [house()] }),
  /** Three cards at once, more often - for a room with people in it. */
  twitchy: fidget({ cards: 3, everyMs: 7000, varyMs: 3000, beats: [house()] }),
  /** Hardly ever, and unhurried when it does. */
  calm: fidget({ everyMs: 40000, varyMs: 12000, beatMs: 900, beats: [house()] }),
  /** A card riffling through a few characters, the way a real one settles. */
  riffle: fidget({ beatMs: 420, beats: [house(), house(), house()] }),
  /** Pineapple, coconut, a slice of lime, and gone. */
  'pina-colada': fidget({
    beatMs: 680,
    beats: [colour('#f2d16b'), colour('#f7f0e0'), colour('#7fbf5f')],
  }),
  /** The same shape, hotter and quicker. */
  rainbow: fidget({
    beatMs: 520,
    beats: [colour('#e0503f'), colour('#e8a33c'), colour('#4a90d9')],
  }),
  /** Three pastels, barely caught. */
  sherbet: fidget({
    beatMs: 380,
    beats: [colour('#f7b8c4'), colour('#bfe3c0'), colour('#cfc0e6')],
  }),
  /** Ping pong: out, back, out - a card that cannot settle. */
  'ping-pong': fidget({
    beatMs: 560,
    beats: [colour('#d8b25a'), origin(), colour('#d8b25a')],
  }),
});

/**
 * What a board's `ambientMs` is set to when a fidget is switched on.
 *
 * The field survives as an on/off, because it is API contract and because a
 * board being *able* to fidget is genuinely a different question from which
 * one it does. Its value stopped meaning anything the moment a fidget
 * started carrying its own pace, so switching one on writes this and nothing
 * reads it back.
 */
export const DEFAULT_AMBIENT_MS = 30000;

/** A fidget by id, or the quietest one. Unknown ids never throw. */
export function fidgetById(id) {
  if (id && Object.prototype.hasOwnProperty.call(FIDGETS, id)) return FIDGETS[id];
  return FIDGETS.tick;
}

/**
 * A fidget from whatever a board was given: a name, or one somebody made.
 *
 * The eight that ship are a starting set, not the set. A board may carry a
 * whole spec instead of an id, which is what the designer produces and what
 * makes it worth having - otherwise it is a page for admiring eight things
 * somebody else chose.
 *
 * Never throws, because this runs on the display: a spec that does not
 * validate is a board misconfigured, not a wall that should go blank, so it
 * falls back to the quiet one the same way an unknown name does.
 */
export function resolveFidget(value) {
  if (typeof value === 'string' || value === null || value === undefined) {
    return fidgetById(value ?? null);
  }
  if (typeof value !== 'object' || Array.isArray(value)) return FIDGETS.tick;
  if (validateFidget(value).length > 0) return FIDGETS.tick;
  return fidget(value);
}

/**
 * Every problem with `spec` at once, as a list of sentences.
 *
 * All of them, not the first - the same contract a theme pack's validator
 * has, so something authoring a fidget can fix everything in one pass rather
 * than discovering the next fault each time it tries.
 */
export function validateFidget(spec) {
  const errors = [];
  const f = { ...FIDGET_DEFAULTS, ...(spec ?? {}) };

  /*
   * Checked as numbers, not coerced into them.
   *
   * `Number(f[key])` accepted the string "14000" and called it valid - and
   * then `nextGapMs` did `f.everyMs + roll * f.varyMs` on the raw value,
   * which is string concatenation. Measured over fifty ticks: about half the
   * gaps came out NaN, and `setTimeout(begin, NaN)` is `setTimeout(begin, 0)`
   * - a fidget running flat out, forever. The rest were numbers like
   * 140003227, which is thirty-nine hours.
   *
   * Nothing reaches this yet (the REST and MCP surfaces take an id from the
   * shipped set, never a spec), so it is the authoring UI this is waiting
   * for, and the authoring UI is exactly what will send strings from a form.
   */
  const number = (key, min, max, { integer = false } = {}) => {
    const value = f[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${key} must be a number, not ${typeof value}`);
      return;
    }
    if (integer && !Number.isInteger(value)) {
      errors.push(`${key} must be a whole number`);
      return;
    }
    if (value < min || value > max) errors.push(`${key} must be between ${min} and ${max}`);
  };
  number('everyMs', 1000, 3_600_000);
  number('beatMs', 40, 5000);
  number('cards', 1, 64, { integer: true });
  number('varyMs', 0, 3_600_000);
  /*
   * Far enough apart that the floor in `nextGapMs` never bites. everyMs 1000
   * with varyMs 999 passed the old "smaller than everyMs" rule and then had
   * four gaps in five clamped to exactly 1000 - a metronome, which is the one
   * thing the variance exists to prevent.
   */
  if (typeof f.everyMs === 'number' && typeof f.varyMs === 'number') {
    if (f.everyMs - f.varyMs < 1000) {
      errors.push('everyMs minus varyMs must be at least 1000, or the gap is a metronome');
    }
  }

  if (!Array.isArray(f.beats) || f.beats.length === 0) {
    errors.push('beats must be a non-empty list - it is the gesture itself');
  } else if (f.beats.length > MAX_BEATS) {
    // The comment on `runMs` argues a cap is unnecessary because the designer
    // will show the duration as you add beats. The designer does not exist
    // yet, and 5000 beats at the top beatMs is a single gesture lasting most
    // of a working day.
    errors.push(`beats has ${f.beats.length} entries; the most a gesture may have is ${MAX_BEATS}`);
  } else {
    f.beats.forEach((beat, index) => {
      if (!beat || typeof beat !== 'object') {
        errors.push(`beats[${index}] must be an object with a kind`);
        return;
      }
      if (!BEAT_KINDS.includes(beat.kind)) {
        errors.push(`beats[${index}].kind must be one of ${BEAT_KINDS.join(', ')}`);
        return;
      }
      if (beat.kind === 'colour' && !HEX.test(String(beat.colour ?? ''))) {
        errors.push(`beats[${index}].colour must be a #rgb or #rrggbb colour`);
      }
    });
    /*
     * A trailing origin beat is not redundant, which took a moment to see.
     * A run always ends with the card back where it started; the question is
     * whether you *watch* it get there. End on a colour and the card simply
     * is not wearing it any more - a gesture that goes out and is gone. End
     * on an origin and the journey home is a beat like any other, flipped
     * and timed with the rest.
     *
     * That is the whole of the vanish-or-fly-home choice the first model
     * spent a field and a bug on, and here it is just the last item in the
     * list.
     */
  }
  return errors;
}
