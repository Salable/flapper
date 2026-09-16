/**
 * A board, rendered with no browser: frames out, as raw pixels.
 *
 * The display and the exporter must be the same board or the export is a
 * drawing of the product rather than the product - so this drives the real
 * `Flipboard` and the real skin, and owns only the two things a browser
 * would otherwise supply: a canvas, and the clock.
 *
 * The clock is the interesting half. `tick(now)` takes its timestamp as an
 * argument and `requestAnimationFrame` only ever supplied it, so an offline
 * renderer hands over the timestamps it wants and gets exactly the frames it
 * asked for - faster than realtime, identical every run, and at whatever
 * frame rate the output needs rather than whatever the machine managed.
 *
 * Pure of ffmpeg, files and argv: this yields frames, and tools/export-video
 * decides what to do with them.
 */

import { Flipboard } from './flipboard.js';
import { ProceduralSkin } from './skins/procedural.mjs';
import { animation, animationFrame, animationRunLength } from './animations.mjs';

/**
 * @param {object} o
 * @param {(w: number, h: number) => object} o.createCanvas a real canvas factory
 *   (@napi-rs/canvas's own, or the browser's - this never names one)
 * @param {object} o.pack   a resolved theme pack
 * @param {number} o.cols
 * @param {number} o.rows
 * @param {number} [o.tilePx] rendered size of one card
 * @param {number} [o.fps]
 */
export function offlineBoard({ createCanvas, pack, cols, rows, tilePx = 48, fps = 30 }) {
  /*
   * The canvas is the board's own size, not a guess with the board letter-
   * boxed inside it.
   *
   * `geometry()` fits the grid to whatever canvas it is given and centres
   * what is left over - fine on a page, where the surrounding space is the
   * design. In a video the leftover is black bars baked into every frame.
   * A card is `tilePx` across with `gapRatio` between, and `padding` around
   * the lot, which is exactly the arithmetic geometry() runs backwards.
   */
  const probeSkin = new ProceduralSkin(pack, { createCanvas: (size) => createCanvas(size, size * 2) });
  const probe = new Flipboard(createCanvas(8, 8), probeSkin, {
    cols,
    rows,
    cssSize: { width: 8, height: 8 },
    pixelRatio: 1,
  });
  const { padding, gapRatio } = probe.opts;
  const span = (n) => Math.round(n * tilePx + (n - 1) * tilePx * gapRatio + padding * 2);
  const width = span(cols);
  const height = span(rows);
  const canvas = createCanvas(width, height);
  const skin = new ProceduralSkin(pack, { createCanvas: (size) => createCanvas(size, size * 2) });
  const board = new Flipboard(canvas, skin, {
    cols,
    rows,
    // Both of the things a browser would have answered.
    cssSize: { width, height },
    pixelRatio: 1,
  });

  let nowMs = 0;
  const stepMs = 1000 / fps;

  return {
    board,
    canvas,
    /** Advance one frame and return the canvas, drawn. */
    step() {
      nowMs += stepMs;
      board.tick(nowMs);
      return canvas;
    },
    /** Put a page up; the flip that follows is what `step` then renders. */
    setPage(lines) {
      board.setPage(lines);
    },
    /**
     * Paint one frame of an animation - the same {index, colour} cells the
     * display's animator hands the board, so an exported explosion is the
     * explosion, not a second implementation of one.
     */
    setAnimationFrame(spec, frame) {
      board.setOptions({
        cardWash: ['#000000'],
        cardWashGlyphs: false,
        cardWashCells: animationFrame(spec, cols, rows, frame),
      });
      board.draw();
      return canvas;
    },
  };
}

/**
 * How many frames an animation is worth at `fps`. A looping one has no
 * length of its own, so it is given `loopSeconds` of wall clock.
 */
export function framesFor(name, cols, rows, { fps = 30, loopSeconds = 6 } = {}) {
  const spec = animation(name);
  if (!spec) return 0;
  const length = animationRunLength(spec, cols, rows);
  if (Number.isFinite(length)) return length;
  return Math.max(1, Math.round((loopSeconds * 1000) / spec.frameMs));
}
