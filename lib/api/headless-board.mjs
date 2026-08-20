/**
 * A board with no canvas, for running the real Controller server-side.
 *
 * `preview` and `capabilities` were round-trips into the renderer on desktop;
 * here they are pure - lay the text out with the same layout/regions/timing
 * code the display runs, against the board's stored config. Animation is
 * irrelevant: nothing enqueued here is ever shown.
 */

import { Controller } from '../board/controller.mjs';
import { layout, layoutRows, charsetFromManifest } from '../board/layout.mjs';
import { footerLayout, composeLines } from '../board/regions.mjs';
import { MOTION_DEFAULTS } from '../board/timing.mjs';
import { DEFAULTS } from '../board/flipboard.js';

function headlessBoard(manifest, config = {}) {
  const charset = charsetFromManifest(manifest);
  const opts = {
    cols: DEFAULTS.cols,
    rows: DEFAULTS.rows,
    footerRows: DEFAULTS.footerRows,
    align: DEFAULTS.align,
    valign: DEFAULTS.valign,
    wrap: DEFAULTS.wrap,
    ...MOTION_DEFAULTS,
  };
  const board = {
    states: manifest.cycle.length,
    tileSize: manifest.tileSize,
    lines: new Map(),
    opts,

    get regions() {
      return footerLayout(opts.cols, opts.rows, opts.footerRows);
    },
    region(id) {
      return this.regions.find((entry) => entry.id === id);
    },
    regionHeight(id) {
      return this.region(id)?.height ?? 0;
    },
    get mainHeight() {
      return this.regionHeight('main');
    },
    get page() {
      if (this.lines.size === 0) return null;
      return composeLines(this.regions, opts.cols, (region) => this.lines.get(region.id));
    },

    layout(text, overrides = {}) {
      return layout(text, {
        charset,
        cols: opts.cols,
        rows: this.mainHeight,
        align: opts.align,
        valign: opts.valign,
        wrap: opts.wrap,
        ...overrides,
      });
    },
    layoutRows(rows, overrides = {}) {
      return layoutRows(rows, { charset, cols: opts.cols, rows: this.mainHeight, ...overrides });
    },
    setRegionPage(id, lines) {
      if (!this.region(id)) return false;
      this.lines.set(id, Array.isArray(lines) ? lines : []);
      return true;
    },
    clear() {
      return this.setRegionPage('main', [' '.repeat(opts.cols)]);
    },
    setOptions(patch) {
      Object.assign(opts, patch);
    },
    isAnimating() {
      return false;
    },
    onRegionIdle() {
      return () => {};
    },
    supportedChars() {
      return manifest.cycle.map((state) => state.char);
    },
  };
  return board;
}

/**
 * A Controller over the stored config, ready for `preview`/`capabilities`.
 * The stored config is a configure patch by construction, so it applies the
 * same way a live board applies it - clamps included.
 */
export function headlessController(manifest, config = {}) {
  const board = headlessBoard(manifest);
  const controller = new Controller(board, {});
  const patch = { ...config };
  delete patch.regions; // per-band dwell needs the bands; applied second
  controller.configure(patch);
  if (config.regions) {
    try {
      controller.configure({ regions: config.regions });
    } catch {
      // A stored per-band setting for a band the current geometry no longer
      // has. The display would have clamped its way here too; ignore it.
    }
  }
  return controller;
}
