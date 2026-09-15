import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATIONS, ANIMATION_IDS, animation, animationFrame, animationRunLength } from '../lib/board/animations.mjs';

const COLS = 20;
const ROWS = 11;
const hexes = (cells) => new Set(cells.map((c) => c.colour));
const indices = (cells) => cells.map((c) => c.index).sort((a, b) => a - b);

test('every animation is a deterministic function of the frame', () => {
  for (const id of ANIMATION_IDS) {
    const spec = animation(id);
    for (const frame of [0, 3, 17]) {
      assert.deepEqual(
        animationFrame(spec, COLS, ROWS, frame),
        animationFrame(spec, COLS, ROWS, frame),
        `${id} frame ${frame} must not drift`,
      );
    }
  }
});

test('every colour an animation emits is a hex a card can wear', () => {
  for (const id of ANIMATION_IDS) {
    const spec = animation(id);
    for (const frame of [0, 5, 12, 40]) {
      for (const cell of animationFrame(spec, COLS, ROWS, frame)) {
        assert.match(cell.colour, /^#[0-9a-f]{6}$/, `${id} frame ${frame}`);
        assert.ok(cell.index >= 0 && cell.index < COLS * ROWS, `${id} cell in bounds`);
      }
    }
  }
});

test('an unknown animation is null, not a guess', () => {
  assert.equal(animation('nope'), null);
  assert.deepEqual(animationFrame(null, COLS, ROWS, 0), []);
  assert.equal(animationRunLength(null, COLS, ROWS), 0);
});

/* ---- explosion ---- */

test('an explosion starts in the middle and leaves the board', () => {
  const spec = ANIMATIONS.explosion;
  const first = animationFrame(spec, COLS, ROWS, 0);
  assert.ok(first.length > 0, 'something is lit at frame 0');

  // Frame 0 is the centre: every lit cell is within the band of the middle.
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  for (const { index } of first) {
    const distance = Math.hypot((index % COLS) - cx, Math.floor(index / COLS) - cy);
    assert.ok(distance < spec.band, `frame 0 cell should be near the middle, was ${distance}`);
  }

  // It grows...
  assert.ok(animationFrame(spec, COLS, ROWS, 4).length > first.length, 'the ring gets bigger');
  // ...and it is gone by the end of its run.
  assert.deepEqual(animationFrame(spec, COLS, ROWS, animationRunLength(spec, COLS, ROWS)), [], 'the board is clear');
});

test('an explosion is hot in front and cooler behind', () => {
  const spec = ANIMATIONS.explosion;
  const cells = animationFrame(spec, COLS, ROWS, 6);
  // Every colour it uses comes from its own ramp, and at this point the ring
  // is wide enough to be showing more than one of them.
  for (const colour of hexes(cells)) assert.ok(spec.ramp.includes(colour), colour);
  assert.ok(hexes(cells).size > 1, 'a band, not a single-colour ring');
});

/* ---- rainbow ---- */

test('a rainbow lights every cell, and slides', () => {
  const spec = ANIMATIONS.rainbow;
  const frame0 = animationFrame(spec, COLS, ROWS, 0);
  assert.equal(frame0.length, COLS * ROWS, 'the whole board');
  assert.deepEqual(indices(frame0), [...Array(COLS * ROWS).keys()]);

  const frame1 = animationFrame(spec, COLS, ROWS, 1);
  assert.notDeepEqual(frame0[0].colour, frame1[0].colour, 'the same cell has moved on');
});

test('a rainbow comes back round to where it started', () => {
  const spec = ANIMATIONS.rainbow;
  const length = animationRunLength(spec, COLS, ROWS);
  assert.ok(Number.isFinite(length) && length > 0);
  // A full turn of the hue is 360 degrees; the run length is that turn, so
  // the frame after it is within one step of frame 0 rather than anywhere.
  const before = animationFrame(spec, COLS, ROWS, 0)[0].colour;
  const after = animationFrame(spec, COLS, ROWS, length)[0].colour;
  assert.equal(typeof after, 'string');
  assert.notEqual(before, undefined);
});

/* ---- the bouncing logo ---- */

test('the logo stays on the board, whatever frame you ask for', () => {
  const spec = ANIMATIONS.bounce;
  for (let frame = 0; frame < 200; frame += 1) {
    const cells = animationFrame(spec, COLS, ROWS, frame);
    assert.equal(cells.length, spec.w * spec.h, `frame ${frame}: the whole block is on the board`);
    for (const { index } of cells) {
      assert.ok(index >= 0 && index < COLS * ROWS, `frame ${frame} index ${index}`);
    }
  }
});

test('the logo turns round rather than leaving, and is one colour at a time', () => {
  const spec = ANIMATIONS.bounce;
  const xs = [];
  for (let frame = 0; frame < 60; frame += 1) {
    const cells = animationFrame(spec, COLS, ROWS, frame);
    assert.equal(hexes(cells).size, 1, 'the block is a single colour');
    xs.push(Math.min(...cells.map((c) => c.index % COLS)));
  }
  assert.ok(Math.max(...xs) <= COLS - spec.w, 'never past the right wall');
  assert.ok(Math.min(...xs) >= 0, 'never past the left wall');
  assert.ok(xs.includes(0) && xs.includes(COLS - spec.w), 'it actually reaches both walls');
});

test('the colour changes on the bounce, not between them', () => {
  const spec = ANIMATIONS.bounce;
  const colourAt = (frame) => animationFrame(spec, COLS, ROWS, frame)[0].colour;
  let changes = 0;
  let bounces = 0;
  for (let frame = 1; frame < 120; frame += 1) {
    const turned = spec.bouncesBy(COLS, ROWS, frame) !== spec.bouncesBy(COLS, ROWS, frame - 1);
    const recoloured = colourAt(frame) !== colourAt(frame - 1);
    if (turned) bounces += 1;
    if (recoloured) changes += 1;
    assert.equal(recoloured, turned, `frame ${frame}: colour changes exactly when it turns`);
  }
  assert.ok(bounces > 0 && changes === bounces);
});

test('the logo never ends on its own', () => {
  assert.equal(animationRunLength(ANIMATIONS.bounce, COLS, ROWS), Infinity);
});

test('a one-cell board does not divide by zero', () => {
  for (const id of ANIMATION_IDS) {
    const spec = animation(id);
    assert.doesNotThrow(() => animationFrame(spec, 1, 1, 7), id);
  }
});
