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
