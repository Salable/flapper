import test from 'node:test';
import assert from 'node:assert/strict';
import {
  borderPath,
  travellerFrame,
  withTraveller,
  runLength,
  traveller,
  TRAVELLERS,
} from '../lib/board/travellers.mjs';
import { ringChars } from '../lib/board/ring.mjs';

test('the border is one lap of the edge, every cell once, and adjacent throughout', () => {
  for (const [cols, rows] of [[6, 4], [16, 3], [20, 11], [2, 2]]) {
    const path = borderPath(cols, rows);
    assert.equal(path.length, 2 * cols + 2 * (rows - 2), `${cols}x${rows}`);
    assert.equal(new Set(path).size, path.length, 'a cell is visited twice');
    // Every step, including the wrap from the last cell back to the first,
    // moves exactly one square - otherwise the creature teleports.
    for (let n = 0; n < path.length; n += 1) {
      const a = path[n];
      const b = path[(n + 1) % path.length];
      const dx = Math.abs((a % cols) - (b % cols));
      const dy = Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
      assert.equal(dx + dy, 1, `${cols}x${rows} jumped from ${a} to ${b}`);
    }
    // And it only ever uses the edge.
    for (const index of path) {
      const x = index % cols;
      const y = Math.floor(index / cols);
      assert.ok(x === 0 || y === 0 || x === cols - 1 || y === rows - 1, 'left the edge');
    }
  }
});

test('a grid too small to have an edge yields no path rather than throwing', () => {
  assert.deepEqual(borderPath(1, 5), []);
  assert.deepEqual(borderPath(5, 1), []);
  assert.equal(runLength(TRAVELLERS.snake, 1, 5), 0);
});

test('every actor appears, in order, and the run ends empty', () => {
  const spec = TRAVELLERS['pac-man'];
  const [cols, rows] = [10, 4];
  const total = runLength(spec, cols, rows);
  const seen = new Set();
  for (let frame = 0; frame < total; frame += 1) {
    for (const { char } of travellerFrame(spec, cols, rows, frame)) seen.add(char);
  }
  assert.deepEqual([...seen].sort(), ['(', ')'], 'pac-man or his ghosts never showed');
  // Past the end nothing is left on the board - the tail has walked off.
  assert.deepEqual(travellerFrame(spec, cols, rows, total), []);
});

test('the head is never eaten by its own tail', () => {
  const spec = TRAVELLERS.snake;
  const [cols, rows] = [8, 3];
  for (let frame = 0; frame < runLength(spec, cols, rows); frame += 1) {
    const cells = travellerFrame(spec, cols, rows, frame);
    const indices = cells.map((c) => c.index);
    assert.equal(new Set(indices).size, indices.length, `frame ${frame} wrote a cell twice`);
    const head = cells.find((c) => c.char === spec.actors[0].glyph);
    if (frame < cols * rows && head) {
      assert.equal(cells.filter((c) => c.index === head.index).length, 1);
    }
  }
});

test('withTraveller only touches the cells it is given', () => {
  const flat = 'ABCDEFGH';
  assert.equal(withTraveller(flat, []), flat);
  assert.equal(withTraveller(flat, [{ index: 0, char: 'O' }]), 'OBCDEFGH');
  // Out of range is ignored rather than growing the page.
  assert.equal(withTraveller(flat, [{ index: 99, char: 'O' }]).length, flat.length);
});

test('an unknown traveller is null, not a throw', () => {
  assert.equal(traveller('no-such-creature'), null);
  assert.equal(traveller(null), null);
  assert.ok(traveller('snake'));
});

test('every traveller glyph is cheap enough to be a gesture, not a revolution', () => {
  // The point of the whole shortest-path change: a cell a creature touches
  // must cost a handful of flips, not a lap. Eight round trip is the budget.
  const chars = ringChars();
  const cost = (glyph) => {
    const at = chars.indexOf(glyph);
    assert.ok(at >= 0, `${glyph} is not on the ring at all`);
    return Math.min(at, chars.length - at);
  };
  for (const [name, spec] of Object.entries(TRAVELLERS)) {
    for (const actor of spec.actors) {
      assert.ok(cost(actor.glyph) * 2 <= 8, `${name}'s ${actor.glyph} costs ${cost(actor.glyph) * 2} flips round trip`);
    }
  }
});
