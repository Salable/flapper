import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAT_KINDS,
  FIDGETS,
  FIDGET_DEFAULTS,
  colour,
  fidget,
  fidgetById,
  house,
  nextGapMs,
  origin,
  pickCells,
  runMs,
  validateFidget,
} from '../lib/board/fidgets.mjs';

test('every fidget that ships is a valid one', () => {
  for (const [id, spec] of Object.entries(FIDGETS)) {
    assert.deepEqual(validateFidget(spec), [], `${id} does not validate`);
  }
});

test('the list is the gesture: its length is the only thing setting the length', () => {
  const one = fidget({ beatMs: 500, beats: [colour('#ff0000')] });
  const four = fidget({ beatMs: 500, beats: [colour('#ff0000'), house(), origin(), house()] });
  assert.equal(runMs(one), 500);
  assert.equal(runMs(four), 2000);
  // Adding a colour adds a beat. There is no count to keep in step with it,
  // which is the whole reason the old flickerCount field is gone.
  const five = fidget({ ...four, beats: [...four.beats, colour('#00ff00')] });
  assert.equal(runMs(five), runMs(four) + four.beatMs);
});

test('position is random, distinct, and always on the grid', () => {
  const spec = fidget({ cards: 4 });
  const seen = new Set();
  for (let tick = 0; tick < 200; tick += 1) {
    const cells = pickCells(spec, 64, tick);
    assert.equal(cells.length, 4, `tick ${tick} picked ${cells.length}`);
    assert.equal(new Set(cells).size, 4, 'the same card twice in one run');
    for (const index of cells) {
      assert.ok(index >= 0 && index < 64, `off the grid: ${index}`);
      seen.add(index);
    }
  }
  // Random means random: over 200 runs it should have reached most of a
  // 64-card board, not favoured a corner.
  assert.ok(seen.size > 48, `only ever landed on ${seen.size} of 64 cards`);
});

test('asking for more cards than the board has gives the board', () => {
  assert.equal(pickCells(fidget({ cards: 40 }), 6, 3).length, 6);
  assert.deepEqual(pickCells(fidget({ cards: 4 }), 0, 3), []);
});

test('the gap varies, stays inside its bounds, and is deterministic', () => {
  const spec = fidget({ everyMs: 10000, varyMs: 4000 });
  const gaps = [];
  for (let tick = 0; tick < 300; tick += 1) {
    const gap = nextGapMs(spec, tick);
    assert.ok(gap >= 6000 && gap <= 14000, `gap ${gap} outside everyMs +/- varyMs`);
    assert.equal(gap, nextGapMs(spec, tick), 'not deterministic');
    gaps.push(gap);
  }
  // A fidget on an exact metronome reads as a clock, which is the one thing
  // it must not be.
  assert.ok(new Set(gaps).size > 100, 'the gap barely varies');
  assert.equal(nextGapMs(fidget({ everyMs: 9000, varyMs: 0 }), 5), 9000);
});

test('a trailing origin beat is a choice, not a mistake', () => {
  /*
   * A run always ends with the card back where it started. Ending on a
   * colour means it simply stops wearing it - out and gone. Ending on an
   * origin means the journey home is a beat like any other, flipped and
   * timed with the rest. Both are legal, and that is the whole of the
   * vanish-or-fly-home question the previous model spent a field on.
   */
  const vanishes = fidget({ beats: [colour('#f2d16b'), colour('#7fbf5f')] });
  const fliesHome = fidget({ beats: [colour('#f2d16b'), colour('#7fbf5f'), origin()] });
  assert.deepEqual(validateFidget(vanishes), []);
  assert.deepEqual(validateFidget(fliesHome), []);
  assert.equal(runMs(fliesHome), runMs(vanishes) + vanishes.beatMs);
});

test('ping pong is a shape you write, not a kind of fidget', () => {
  // Nothing in the model knows the word. It is a list with an as-it-was in
  // the middle, which is the point of having only three beat kinds.
  const pingPong = FIDGETS['ping-pong'];
  assert.deepEqual(
    pingPong.beats.map((beat) => beat.kind),
    ['colour', 'origin', 'colour'],
  );
  assert.deepEqual(validateFidget(pingPong), []);
});

test('the validator names every problem at once, not the first', () => {
  const errors = validateFidget({
    everyMs: 500,
    varyMs: 9000,
    cards: 0,
    beatMs: 10,
    beats: [{ kind: 'colour', colour: 'lime' }, { kind: 'wobble' }, 'nope'],
  });
  // Something authoring a fidget should be able to fix it in one pass.
  assert.ok(errors.length >= 6, `only found ${errors.length}: ${errors.join(' | ')}`);
  assert.ok(errors.some((e) => e.includes('everyMs')));
  assert.ok(errors.some((e) => e.includes('varyMs')));
  assert.ok(errors.some((e) => e.includes('cards')));
  assert.ok(errors.some((e) => e.includes('beatMs')));
  assert.ok(errors.some((e) => e.includes('beats[0].colour')));
  assert.ok(errors.some((e) => e.includes('beats[1].kind')));
});

test('an empty list is refused - the list is the gesture', () => {
  assert.ok(validateFidget({ beats: [] }).some((e) => e.includes('non-empty')));
});

test('an unknown id is the quiet one, never a throw', () => {
  assert.equal(fidgetById('no-such-fidget'), FIDGETS.tick);
  assert.equal(fidgetById(null), FIDGETS.tick);
  assert.equal(fidgetById('pina-colada'), FIDGETS['pina-colada']);
});

test('the defaults are slower than the first model shipped', () => {
  // Dan, having watched all eleven of the first set: "all our flickers seem
  // to be a little fast". They were tuned against a board delivering a
  // message (55ms a step), not against a room somebody is sitting in.
  assert.ok(FIDGET_DEFAULTS.beatMs >= 500, 'the default beat is back to being brisk');
  assert.deepEqual(BEAT_KINDS, ['colour', 'house', 'origin']);
});

/*
 * The tests below exist because an adversarial pass mutated the source
 * sixteen ways and this suite caught two of them. Each one here pins a
 * mutation that survived: what a beat helper actually builds, that the gap
 * can fall *early* as well as late, the clamp on cards, the lookup that must
 * not see Object.prototype, and the defaults themselves. A suite that only
 * checks the happy path is a suite that agrees with whatever the code does.
 */

test('each beat helper builds its own kind, and nothing else', () => {
  // house() returning origin() passed every other test in this file.
  assert.deepEqual(house(), { kind: 'house' });
  assert.deepEqual(origin(), { kind: 'origin' });
  assert.deepEqual(colour('#abcdef'), { kind: 'colour', colour: '#abcdef' });
  for (const beat of [house(), origin(), colour('#abcdef')]) {
    assert.ok(Object.isFrozen(beat), 'a beat should not be editable in place');
  }
});

test('the gap falls early as often as late', () => {
  /*
   * The variance is `(roll * 2 - 1) * varyMs`, and dropping the `* 2 - 1`
   * leaves a fidget that is only ever *late* - still inside the bounds, still
   * varied, and wrong. A board that never fidgets sooner than its interval
   * drifts steadily later, which is the metronome problem wearing a hat.
   */
  const spec = fidget({ everyMs: 10000, varyMs: 4000 });
  let early = 0;
  let late = 0;
  for (let tick = 0; tick < 300; tick += 1) {
    const gap = nextGapMs(spec, tick);
    if (gap < spec.everyMs) early += 1;
    if (gap > spec.everyMs) late += 1;
  }
  assert.ok(early > 60, `only ${early} of 300 gaps were early`);
  assert.ok(late > 60, `only ${late} of 300 gaps were late`);
});

test('cards is clamped to the board, not merely exhausted by it', () => {
  // Dropping the clamp happens to give the right count on a small grid, since
  // the loop runs out of distinct cells anyway. On a large grid it does not.
  assert.equal(pickCells(fidget({ cards: 64 }), 4096, 11).length, 64);
  assert.equal(pickCells(fidget({ cards: 64 }), 20, 11).length, 20);
});

test('a fidget lookup never reaches Object.prototype', () => {
  // `id in FIDGETS` instead of hasOwnProperty hands back a function for
  // 'toString', and a board config is caller-supplied text.
  for (const id of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(fidgetById(id), FIDGETS.tick, `${id} resolved to something`);
  }
});

test('the defaults are the defaults', () => {
  // Every one of these was unpinned, so a mutation to any of them passed.
  assert.equal(FIDGET_DEFAULTS.cards, 1);
  assert.equal(FIDGET_DEFAULTS.everyMs, 14000);
  assert.equal(FIDGET_DEFAULTS.varyMs, 5000);
  assert.ok(FIDGET_DEFAULTS.varyMs > 0, 'a fidget with no variance is a clock');
  assert.deepEqual(FIDGET_DEFAULTS.beats, [house()]);
  assert.ok(Object.isFrozen(fidget({})), 'a fidget should not be editable in place');
});

test('a spec is checked as numbers, not coerced into them', () => {
  /*
   * A form sends strings. `Number("14000")` validated fine and then
   * `everyMs + roll * varyMs` concatenated, giving NaN gaps - and
   * setTimeout(fn, NaN) is setTimeout(fn, 0), a fidget running flat out.
   */
  assert.ok(validateFidget({ everyMs: '14000' }).some((e) => /everyMs must be a number/.test(e)));
  assert.ok(validateFidget({ beatMs: '600' }).some((e) => /beatMs must be a number/.test(e)));
  assert.ok(validateFidget({ cards: '2' }).some((e) => /cards must be a number/.test(e)));
  assert.ok(validateFidget({ cards: 1.5 }).some((e) => /whole number/.test(e)));
  assert.ok(validateFidget({ everyMs: NaN }).some((e) => /everyMs must be a number/.test(e)));
});

test('the bounds are real bounds at both ends', () => {
  assert.deepEqual(validateFidget({ cards: 64 }), []);
  assert.ok(validateFidget({ cards: 65 }).some((e) => /cards must be between/.test(e)));
  assert.ok(validateFidget({ everyMs: 3_600_001 }).some((e) => /everyMs must be between/.test(e)));
  assert.ok(validateFidget({ beatMs: 5001 }).some((e) => /beatMs must be between/.test(e)));
  assert.ok(validateFidget({ beatMs: 39 }).some((e) => /beatMs must be between/.test(e)));
});

test('a gesture cannot be arbitrarily long', () => {
  // 5000 beats at the top beatMs is one gesture lasting most of a working day.
  assert.deepEqual(validateFidget({ beats: Array(32).fill(house()) }), []);
  assert.ok(
    validateFidget({ beats: Array(33).fill(house()) }).some((e) => /the most a gesture may have/.test(e)),
  );
});

test('the variance can never be clamped into a metronome', () => {
  /*
   * everyMs 1000 with varyMs 999 passed the old rule and then hit the floor
   * in nextGapMs: four gaps in five came out at exactly 1000. Refused at the
   * spec now, so the floor is a backstop rather than a behaviour.
   */
  assert.ok(
    validateFidget({ everyMs: 1000, varyMs: 999 }).some((e) => /metronome/.test(e)),
  );
  const fine = fidget({ everyMs: 6000, varyMs: 4000 });
  assert.deepEqual(validateFidget(fine), []);
  const gaps = new Set();
  for (let tick = 0; tick < 200; tick += 1) gaps.add(nextGapMs(fine, tick));
  assert.ok(gaps.size > 80, `only ${gaps.size} distinct gaps - that is a clock`);
});
