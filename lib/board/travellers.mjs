/**
 * Travelling fidgets: a creature that walks the board.
 *
 * The other fidgets (idle.mjs) are one card briefly wrong and then right
 * again - stateless, one tick, no idea how wide the board is. A snake or a
 * pac-man is a different animal: something with a *position* that advances
 * over many frames, putting the board back behind it as it goes. It needs
 * the grid, and it needs its own clock, because the fidget interval is
 * measured in seconds and a creature moves in frames.
 *
 * Pure, like the rest of lib/board: a deterministic function of the frame
 * number. ambient.ts owns the timer; this owns what a frame looks like.
 *
 * A note on glyphs, which is really a note about arithmetic.
 *
 * The ring is blank, A-Z, 0-9 and `. , ! ( )` - there is no sprite sheet, so
 * a traveller is spelled out of the characters the board actually has. But
 * the choice is not free: a card lights up by travelling from blank to the
 * glyph and goes dark by travelling back, so the glyph's distance from blank
 * *is* the cost of every cell the creature touches. `O` sits fifteen steps
 * in - thirty flips a cell, round trip - which is why the first version of
 * this read as a long smeared comet rather than a creature.
 *
 * Cheap glyphs are the ones nearest blank at either end of the ring:
 * A(1) B(2) C(3) D(4) E(5), and coming the other way `)`(1) `(`(2) `!`(3)
 * `,`(4) `.`(5). Everything here is chosen from those, so a cell costs eight
 * flips round trip at worst.
 *
 * A design that wants a real pac-man can already give any single character
 * its own uploaded mark (see a pack's `art`) - so the shape is a design
 * decision and the arithmetic is this file's.
 */

/**
 * The cells around the edge of a `cols x rows` grid, clockwise from the top
 * left. One lap is one full circuit.
 *
 * @returns {number[]} flat page indices, in travel order
 */
export function borderPath(cols, rows) {
  if (cols < 2 || rows < 2) return [];
  const at = (x, y) => y * cols + x;
  const cells = [];
  for (let x = 0; x < cols; x += 1) cells.push(at(x, 0));
  for (let y = 1; y < rows; y += 1) cells.push(at(cols - 1, y));
  for (let x = cols - 2; x >= 0; x -= 1) cells.push(at(x, rows - 1));
  for (let y = rows - 2; y >= 1; y -= 1) cells.push(at(0, y));
  return cells;
}

/** The travellers that ship. Referenced from a fidget style by name. */
export const TRAVELLERS = Object.freeze({
  /**
   * Snake: a head and a short tail, once round the edge.
   * The tail is the same glyph faded only by being behind - the board has no
   * opacity, so length is the whole of the effect.
   */
  snake: Object.freeze({
    path: 'border',
    stepMs: 120,
    laps: 1,
    actors: Object.freeze([
      // D is the roundest head within budget (4 flips); the comma trails.
      Object.freeze({ glyph: 'D', length: 1, lead: 0 }),
      Object.freeze({ glyph: ',', length: 4, lead: 1 }),
    ]),
  }),
  /**
   * Pac-man, and three ghosts strung out behind him, once round the edge.
   * `lead` is how many cells back an actor starts from the head.
   */
  'pac-man': Object.freeze({
    path: 'border',
    stepMs: 150,
    laps: 1,
    actors: Object.freeze([
      // An open mouth two steps from blank, chased by three closing ones.
      Object.freeze({ glyph: '(', length: 1, lead: 0 }),
      Object.freeze({ glyph: ')', length: 1, lead: 3 }),
      Object.freeze({ glyph: ')', length: 1, lead: 5 }),
      Object.freeze({ glyph: ')', length: 1, lead: 7 }),
    ]),
  }),
});

/** A traveller by name, or null. */
export function traveller(name) {
  if (name && Object.prototype.hasOwnProperty.call(TRAVELLERS, name)) return TRAVELLERS[name];
  return null;
}

/** How many frames one full run takes, so a caller knows when to stop. */
export function runLength(spec, cols, rows) {
  const path = borderPath(cols, rows);
  if (path.length === 0) return 0;
  const trailing = Math.max(
    0,
    ...spec.actors.map((actor) => actor.lead + actor.length),
  );
  // Long enough for the last of the tail to leave by the way it came in.
  return path.length * spec.laps + trailing;
}

/**
 * What the board shows at `frame` of a run: the cells this traveller is
 * currently occupying, and with what.
 *
 * Cells that have not been reached yet, or that the tail has already left,
 * are simply absent - the caller paints the standing page underneath and
 * only overwrites what comes back from here, so the board restores itself
 * behind the creature with no bookkeeping.
 *
 * @returns {Array<{index: number, char: string}>}
 */
export function travellerFrame(spec, cols, rows, frame) {
  const path = borderPath(cols, rows);
  if (path.length === 0) return [];
  const cells = [];
  const taken = new Set();
  for (const actor of spec.actors) {
    for (let n = 0; n < actor.length; n += 1) {
      const at = frame - actor.lead - n;
      // Before it has entered, or after the run is over for this actor.
      if (at < 0 || at >= path.length * spec.laps) continue;
      const index = path[at % path.length];
      // The head wins where a tail would overlap it - actors are in order.
      if (taken.has(index)) continue;
      taken.add(index);
      cells.push({ index, char: actor.glyph });
    }
  }
  return cells;
}

/** `page` (flat) with the traveller's cells written over it. */
export function withTraveller(flat, cells) {
  if (cells.length === 0) return flat;
  const chars = [...flat];
  for (const { index, char } of cells) {
    if (index >= 0 && index < chars.length) chars[index] = char;
  }
  return chars.join('');
}
