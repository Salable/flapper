import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { offlineBoard, framesFor } from '../lib/board/offline.mjs';
import { animation, ANIMATION_IDS } from '../lib/board/animations.mjs';
import { resolveBoardTheme } from '../lib/board/board-theme.mjs';

const COLS = 12;
const ROWS = 5;
const { pack } = resolveBoardTheme({}, {});
const make = (over = {}) => offlineBoard({ createCanvas, pack, cols: COLS, rows: ROWS, tilePx: 16, ...over });

test('a board renders with no browser at all', () => {
  const render = make();
  assert.ok(render.canvas.width > 0 && render.canvas.height > 0);
  render.setPage(['HELLO       ', '            ', '            ', '            ', '            ']);
  const png = render.step().toBuffer('image/png');
  assert.ok(png.length > 1000, 'a real PNG came out');
  // PNG magic, so this is an image rather than an error page's worth of bytes.
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('the canvas is the board, not the board letterboxed inside one', () => {
  // The grid is wider than it is tall, so the frame must be too - a canvas
  // guessed at rather than derived bakes black bars into every frame.
  const render = make();
  assert.ok(
    render.canvas.width > render.canvas.height,
    `${render.canvas.width}x${render.canvas.height} for a ${COLS}x${ROWS} grid`,
  );
});

test('asking for the same frame twice draws the same frame, because time is an argument', () => {
  // Within a render, not across two of them: a skin bakes random grunge
  // specks into its cards (procedural.mjs paintGrunge), which is texture
  // rather than content - deliberately "not anything a test or a viewer
  // compares frame to frame". What has to be deterministic is which cells
  // are lit and what colour, and that is a pure function of the frame
  // number either way (lib/board/animations.mjs).
  const render = make();
  render.setAnimationFrame(animation('explosion'), 5);
  const first = render.canvas.toBuffer('image/png');
  render.setAnimationFrame(animation('explosion'), 9);
  render.setAnimationFrame(animation('explosion'), 5);
  const again = render.canvas.toBuffer('image/png');

  assert.deepEqual(first, again, 'frame 5 is frame 5, whatever was drawn in between');
});

test('two different frames of an animation are two different images', () => {
  const render = make();
  render.setAnimationFrame(animation('rainbow'), 0);
  const a = render.canvas.toBuffer('image/png');
  render.setAnimationFrame(animation('rainbow'), 7);
  const b = render.canvas.toBuffer('image/png');
  assert.notDeepEqual(a, b);
});

test('stepping drives the flip itself, without a clock', () => {
  const render = make();
  render.setPage(['ALPHA       ', '            ', '            ', '            ', '            ']);
  const mid = render.step().toBuffer('image/png');
  for (let n = 0; n < 60; n += 1) render.step();
  const settled = render.canvas.toBuffer('image/png');
  assert.notDeepEqual(mid, settled, 'the tiles were still moving on the first frame');
  assert.equal(render.board.tiles.every((tile) => tile.progress === 0), true, 'and have landed by the end');
});

test('a finite animation has a length; a looping one is given one', () => {
  for (const id of ANIMATION_IDS) {
    assert.ok(framesFor(id, COLS, ROWS, { fps: 30, loopSeconds: 2 }) > 0, id);
  }
  // bounce never ends on its own, so its length comes from the seconds asked
  // for rather than from the animation.
  const short = framesFor('bounce', COLS, ROWS, { fps: 30, loopSeconds: 1 });
  const long = framesFor('bounce', COLS, ROWS, { fps: 30, loopSeconds: 4 });
  assert.ok(long > short);
  // An explosion ends, so the seconds asked for make no difference.
  assert.equal(
    framesFor('explosion', COLS, ROWS, { loopSeconds: 1 }),
    framesFor('explosion', COLS, ROWS, { loopSeconds: 30 }),
  );
  assert.equal(framesFor('nope', COLS, ROWS), 0);
});
