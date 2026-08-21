/**
 * Split-flap board renderer.
 *
 * The board is a grid of tiles drawn to a single canvas. Every tile shares the
 * same cycle of states (by default 42: blank, A-Z, 0-9, . , ! ( ) ). How a
 * state *looks*, and how the flap from state `i` to `i + 1` looks partway
 * through, is the business of a **skin** (lib/board/skins/): the engine hands
 * it `(state, progress)` per tile and the skin paints. A tile is therefore
 *
 *   { state, pending, progress }   state: where it rests or is leaving from
 *                                  progress: 0 at rest, (0,1) mid-flap
 *
 * Two skins ship: SpriteSkin draws pre-rendered strips, ProceduralSkin draws
 * the flap from a theme pack. The engine does not know which it has.
 *
 * Like a real split-flap, tiles only travel forward through the cycle: getting
 * from Z to A means passing through 0-9 and the punctuation. Steps run fast and
 * then decelerate into the landing, which is what gives the board its
 * characteristic settle.
 *
 * At rest the animation loop stops entirely and the canvas holds the last
 * drawn frame — a steady state costs nothing.
 */

import {
  layout,
  layoutRows,
  charsetFromManifest,
  DEFAULTS as LAYOUT_DEFAULTS,
} from './layout.mjs';
import { MOTION_DEFAULTS, stepDuration as stepDurationFor, sweepFraction } from './timing.mjs';
import {
  MAIN,
  footerLayout,
  regionCoords,
  regionTargets,
  composeLines,
} from './regions.mjs';

export const DEFAULTS = {
  cols: 20,
  rows: 8,
  footerRows: 0, // rows reserved at the bottom for a separately-driven band
  align: 'center', // 'left' | 'center' | 'right'
  padding: 24, // CSS px around the board
  gapRatio: 0.035, // gap between tiles as a fraction of tile size
  background: '#0a0a0b',
  ...MOTION_DEFAULTS,
  wrap: LAYOUT_DEFAULTS.wrap,
  valign: LAYOUT_DEFAULTS.valign,
  alwaysFlip: false, // make a tile do a full revolution rather than hold
};

export class Flipboard {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./skins/skin.mjs').Skin} skin what a state and a flap look like
   * @param {object} [options] overrides for DEFAULTS
   */
  constructor(canvas, skin, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.skin = skin;
    this.cycle = skin.cycle;
    this.states = skin.cycle.length;
    this.tileSize = skin.tileSize;
    this.opts = { ...DEFAULTS, ...options };

    this.charToState = new Map();
    this.cycle.forEach((state, i) => this.charToState.set(state.char, i));
    this.blank = this.cycle.findIndex((state) => state.name === 'blank');
    if (this.blank < 0) throw new Error('skin has no blank state');
    this.charset = charsetFromManifest(skin);

    /** Idle listeners per band. Each band settles on its own clock. */
    this.idleListeners = new Map();
    /** Last lines shown in each band, kept so `page` can report the whole board. */
    this.regionLines = new Map();

    /**
     * Flap listener: `(flaps, cols)` once per animation frame in which any
     * tile stepped a state, with one `{index, col, row}` per step. The sound
     * hangs off this (lib/board/audio.mjs); nothing else in the renderer
     * depends on it, and it is a property rather than an option so a config
     * patch can never reach it.
     */
    this.onFlap = null;

    this.tiles = [];
    this.raf = null;
    this.lastTick = 0;
    this.dpr = 1;
    this.text = '';

    this.setGrid(this.opts.cols, this.opts.rows);
  }

  /* ---- bands ---- */

  /**
   * Recompute the row bands. Called whenever the grid or the footer height
   * changes, since both move the boundary.
   */
  recomputeRegions() {
    this.regions = footerLayout(this.opts.cols, this.opts.rows, this.opts.footerRows);
    this.regionIndex = new Map(this.regions.map((region) => [region.id, region]));
    // A band that no longer exists has nothing to report.
    for (const id of [...this.regionLines.keys()]) {
      if (!this.regionIndex.has(id)) this.regionLines.delete(id);
    }
  }

  region(regionId) {
    return this.regionIndex.get(regionId);
  }

  regionHeight(regionId) {
    return this.regionIndex.get(regionId)?.height ?? 0;
  }

  /** Rows available to the main queue - the row budget for a message. */
  get mainHeight() {
    return this.regionHeight(MAIN);
  }

  /** What is physically on the glass, all bands stitched together. */
  get page() {
    if (this.regionLines.size === 0) return null;
    return composeLines(this.regions, this.opts.cols, (region) => this.regionLines.get(region.id));
  }

  /**
   * Subscribe to a band settling.
   * @returns {() => void} unsubscribe
   */
  onRegionIdle(regionId, listener) {
    const listeners = this.idleListeners.get(regionId) ?? new Set();
    listeners.add(listener);
    this.idleListeners.set(regionId, listeners);
    return () => listeners.delete(listener);
  }

  emitIdle(regionId) {
    const listeners = this.idleListeners.get(regionId);
    if (!listeners) return;
    // Copy, because a listener may unsubscribe itself; and isolate, because one
    // broken listener must not stop the others from hearing about it.
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error(`region idle listener for ${regionId} failed`, error);
      }
    }
  }

  /**
   * Swap the skin under the board - a theme change. The new skin must be
   * the same cycle (same states in the same order); the tiles themselves,
   * their positions and anything in flight are untouched, so a board can
   * change colour mid-message without a flicker of the wrong glyph.
   */
  setSkin(skin) {
    if (skin.cycle.length !== this.states) {
      throw new Error(`skin has ${skin.cycle.length} states, board has ${this.states}`);
    }
    skin.cycle.forEach((state, i) => {
      if (state.char !== this.cycle[i].char) {
        throw new Error(`skin state ${i} is ${JSON.stringify(state.char)}, expected ${JSON.stringify(this.cycle[i].char)}`);
      }
    });
    this.skin = skin;
    this.tileSize = skin.tileSize;
    this.draw();
  }

  /** Characters the board can display, in cycle order. */
  supportedChars() {
    return this.cycle.map((state) => state.char);
  }

  makeTile() {
    return { state: this.blank, pending: 0, progress: 0, elapsed: 0, wait: 0 };
  }

  setGrid(cols, rows) {
    const total = Math.max(1, cols * rows);
    const previous = this.tiles;
    this.opts.cols = cols;
    this.opts.rows = rows;
    this.tiles = Array.from({ length: total }, (_, i) => previous[i] || this.makeTile());
    // Stable per-tile offsets, so the 'random' sweep doesn't reshuffle mid-flip.
    this.jitter = Array.from({ length: total }, () => Math.random());
    this.recomputeRegions();
    this.resize();
  }

  setOptions(patch) {
    const gridChanged =
      ('cols' in patch && patch.cols !== this.opts.cols) ||
      ('rows' in patch && patch.rows !== this.opts.rows);
    // A footer change moves the boundary without changing the tile count, so it
    // needs the bands rebuilt but not the tiles reallocated.
    const bandsChanged =
      'footerRows' in patch && patch.footerRows !== this.opts.footerRows;
    Object.assign(this.opts, patch);
    if (gridChanged) {
      this.setGrid(this.opts.cols, this.opts.rows);
    } else if (bandsChanged) {
      this.recomputeRegions();
      this.draw();
    } else {
      this.draw();
    }
  }

  /** Re-read the canvas box and repaint. Call on resize / DPR change. */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.dpr = dpr;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.draw();
  }

  /**
   * Board geometry in device pixels, so tiles land on whole pixels and never
   * show a seam between them.
   */
  geometry() {
    const { cols, rows, padding, gapRatio } = this.opts;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const inset = padding * this.dpr;
    const availWidth = Math.max(1, width - inset * 2);
    const availHeight = Math.max(1, height - inset * 2);

    // size + gap must fit: cols * size + (cols - 1) * size * gapRatio
    const size = Math.max(
      1,
      Math.floor(
        Math.min(
          availWidth / (cols + (cols - 1) * gapRatio),
          availHeight / (rows + (rows - 1) * gapRatio),
        ),
      ),
    );
    const gap = Math.round(size * gapRatio);
    const boardWidth = cols * size + (cols - 1) * gap;
    const boardHeight = rows * size + (rows - 1) * gap;
    return {
      size,
      gap,
      x: Math.round((width - boardWidth) / 2),
      y: Math.round((height - boardHeight) / 2),
    };
  }

  draw() {
    const { ctx } = this;
    const { cols, rows } = this.opts;
    ctx.fillStyle = this.opts.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const { size, gap, x, y } = this.geometry();
    const { skin } = this;
    if (skin.prepare) skin.prepare(size);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const tile = this.tiles[row * cols + col];
        if (!tile) continue;
        skin.drawTile(ctx, tile.state, tile.progress, x + col * (size + gap), y + row * (size + gap), size);
      }
    }
  }

  /** How long the step with `remaining` flips left (inclusive) should take. */
  stepDuration(remaining) {
    return stepDurationFor(remaining, this.opts);
  }

  /**
   * Stagger delay for a tile. Derived from `sweepMs` as a fraction of the band
   * it belongs to, so the wave takes the same wall-clock time whatever the band
   * size - a two-row footer sweeps across itself rather than inheriting a
   * lead-in proportional to the rows above it.
   */
  staggerDelay(index, region) {
    const { cols, sweepMs, staggerMode } = this.opts;
    if (!sweepMs) return 0;
    const band = region ?? { start: 0, height: this.opts.rows };
    const { row, col } = regionCoords(index, cols, band);
    return sweepMs * sweepFraction(row, col, band.height, cols, staggerMode, this.jitter[index] || 0);
  }

  /** Whether the board, or one band of it, still has tiles in flight. */
  isAnimating(regionId) {
    if (regionId === undefined) return this.tiles.some((tile) => tile.pending > 0);
    const region = this.regionIndex.get(regionId);
    if (!region) return false;
    for (let i = region.start; i < region.end; i += 1) {
      if (this.tiles[i].pending > 0) return true;
    }
    return false;
  }

  start() {
    if (this.raf !== null) return;
    this.lastTick = performance.now();
    this.schedule();
  }

  schedule() {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  tick(now) {
    this.raf = null;
    // Clamp so a backgrounded window doesn't fast-forward the whole board.
    const dt = Math.min(100, Math.max(0, now - this.lastTick));
    this.lastTick = now;

    const moved = [];
    const flaps = this.onFlap ? [] : null;
    const { cols } = this.opts;
    for (const region of this.regions) {
      let regionMoved = false;
      for (let index = region.start; index < region.end; index += 1) {
        const tile = this.tiles[index];
        if (tile.pending === 0) continue;
        regionMoved = true;

        let budget = dt;
        if (tile.wait > 0) {
          const used = Math.min(tile.wait, budget);
          tile.wait -= used;
          budget -= used;
          if (tile.wait > 0) continue;
        }
        tile.elapsed += budget;

        while (tile.pending > 0) {
          const duration = this.stepDuration(tile.pending);
          if (tile.elapsed < duration) break;
          tile.elapsed -= duration;
          tile.state = (tile.state + 1) % this.states;
          tile.pending -= 1;
          if (flaps) flaps.push({ index, col: index % cols, row: Math.floor(index / cols) });
        }

        if (tile.pending > 0) {
          const duration = this.stepDuration(tile.pending);
          tile.progress = Math.min(0.999999, tile.elapsed / duration);
        } else {
          tile.progress = 0;
          tile.elapsed = 0;
        }
      }
      if (regionMoved) moved.push(region.id);
    }

    this.draw();

    if (flaps && flaps.length > 0) {
      try {
        this.onFlap(flaps, cols);
      } catch (error) {
        console.error('flap listener failed', error);
      }
    }

    // Schedule before emitting. A listener may retarget its own band from
    // inside the callback, and start() must find the frame already armed
    // rather than resetting lastTick part-way through this one.
    if (this.isAnimating()) this.schedule();

    for (const id of moved) {
      if (!this.isAnimating(id)) this.emitIdle(id);
    }
  }

  /**
   * Flip one band to a pre-laid-out page: exactly that band's height in strings
   * of `cols` characters, as produced by the layout engine.
   *
   * Safe to call mid-flip. A tile already in motion finishes its current step
   * and then continues forward to the new target, so retargeting never snaps.
   *
   * The loop cannot reach a tile outside the band, which is what keeps one
   * band's traffic from disturbing another's - it is a property of the range,
   * not a convention the callers have to maintain.
   *
   * @param {string} regionId
   * @param {string[]} lines
   * @param {{immediate?: boolean, sweepBasis?: 'region'|'board'}} [options]
   *   `sweepBasis: 'board'` staggers across the whole grid instead of the band,
   *   for a repaint that should read as one wave rather than one per band.
   * @returns {boolean} false if the band does not exist
   */
  setRegionPage(regionId, lines, { immediate = false, sweepBasis = 'region' } = {}) {
    const region = this.regionIndex.get(regionId);
    // Not a throw: a driver holding a footer can outlive the footer being
    // configured away, and should not crash when it does.
    if (!region) return false;

    const source = Array.isArray(lines) ? lines : [];
    const targets = regionTargets(source, region, this.opts.cols, this.charToState, this.blank);
    this.regionLines.set(regionId, source);

    const basis = sweepBasis === 'board'
      ? { start: 0, height: this.opts.rows }
      : region;

    for (let i = 0; i < targets.length; i += 1) {
      const index = region.start + i;
      const tile = this.tiles[index];
      const target = targets[i];

      if (immediate) {
        tile.state = target;
        tile.pending = 0;
        tile.progress = 0;
        tile.elapsed = 0;
        tile.wait = 0;
        continue;
      }

      const inMotion = tile.pending > 0;
      let steps = (target - tile.state + this.states) % this.states;
      // A tile that has already committed to leaving its current state has to
      // go all the way round to land on it again.
      if (steps === 0 && (inMotion || this.opts.alwaysFlip)) steps = this.states;
      if (steps === 0) continue;

      tile.pending = steps;
      if (!inMotion) {
        tile.elapsed = 0;
        tile.wait = this.staggerDelay(index, basis);
      }
    }

    if (immediate) {
      // Only park the frame loop if no *other* band is still running.
      if (!this.isAnimating()) this.stop();
      this.draw();
    } else if (this.isAnimating()) {
      this.start();
    } else {
      this.draw();
    }
    return true;
  }

  /** Flip the main band. The board's default target. */
  setPage(lines, options) {
    this.setRegionPage(MAIN, lines, options);
    return this;
  }

  /**
   * Lay `text` out for the current grid. Does not touch the board.
   *
   * Defaults to the main band's height, not the physical grid: a message's row
   * budget is the space it will actually play in. Pass `rows` to target another
   * band.
   */
  layout(text, overrides = {}) {
    return layout(text, {
      charset: this.charset,
      cols: this.opts.cols,
      rows: this.mainHeight,
      align: this.opts.align,
      valign: this.opts.valign,
      wrap: this.opts.wrap,
      ...overrides,
    });
  }

  /** Lay an explicit grid of rows out for the current board. Literal. */
  layoutRows(rows, overrides = {}) {
    return layoutRows(rows, {
      charset: this.charset,
      cols: this.opts.cols,
      rows: this.mainHeight,
      ...overrides,
    });
  }

  /**
   * Convenience: lay `text` out and show its first page. Text that needs more
   * than one page is the controller's job, not the board's.
   * @returns {object} layout diagnostics
   */
  setText(text, { immediate = false, ...overrides } = {}) {
    const { pages, diagnostics } = this.layout(text, overrides);
    this.text = String(text ?? '');
    this.setPage(pages[0], { immediate });
    return diagnostics;
  }

  /** Blank the main band. Other bands are left alone - that is the point of them. */
  clear(options) {
    return this.setText('', options);
  }

  /** Blank every band, including any footer. */
  clearAll(options) {
    for (const region of this.regions) this.setRegionPage(region.id, [], options);
    return this;
  }
}
