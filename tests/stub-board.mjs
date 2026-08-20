import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { Controller } from '../lib/board/controller.mjs';
import { layout, layoutRows, charsetFromManifest } from '../lib/board/layout.mjs';
import { footerLayout, composeLines } from '../lib/board/regions.mjs';
import { MOTION_DEFAULTS } from '../lib/board/timing.mjs';

/**
 * Shared test board. Lives outside a *.test.mjs file so `node --test` does not
 * collect it, and so the panel tests can drive a real Controller rather than
 * asserting against hand-written status fixtures.
 */

const manifest = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url)));
const charset = charsetFromManifest(manifest);

export { manifest, charset };

/**
 * A board stand-in. Real animation is irrelevant here; what matters is the
 * contract a track depends on — that a band shown without `immediate`
 * eventually reports settling, and with `immediate` never does.
 *
 * Bands come from the real `regions.mjs`, and each animates independently, so
 * the "a footer settling must not move the main queue on" behaviour is
 * exercised rather than assumed.
 */
export function stubBoard(cols = 10, rows = 1, footerRows = 0) {
  return {
    states: manifest.cycle.length,
    tileSize: manifest.tileSize,
    animating: new Set(),
    idle: new Map(),
    lines: new Map(),
    shown: [],
    pages: [],
    opts: { cols, rows, footerRows, align: 'left', valign: 'top', wrap: 'word', ...MOTION_DEFAULTS },

    get regions() {
      return footerLayout(this.opts.cols, this.opts.rows, this.opts.footerRows);
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
      return composeLines(this.regions, this.opts.cols, (region) => this.lines.get(region.id));
    },

    layout(text, overrides = {}) {
      return layout(text, {
        charset,
        cols: this.opts.cols,
        rows: this.mainHeight,
        align: this.opts.align,
        valign: this.opts.valign,
        wrap: this.opts.wrap,
        ...overrides,
      });
    },
    layoutRows(rows, overrides = {}) {
      return layoutRows(rows, {
        charset,
        cols: this.opts.cols,
        rows: this.mainHeight,
        ...overrides,
      });
    },
    setRegionPage(id, lines, { immediate = false } = {}) {
      if (!this.region(id)) return false;
      const source = Array.isArray(lines) ? lines : [];
      this.lines.set(id, source);
      // `shown` keeps the original single-band shape the older tests read.
      if (id === 'main') this.shown.push(source.join('|').trim());
      this.pages.push({ region: id, lines: source.slice() });
      if (immediate) this.animating.delete(id);
      else this.animating.add(id);
      return true;
    },
    setPage(lines, options) {
      this.setRegionPage('main', lines, options);
      return this;
    },
    clear(options) {
      return this.setPage([' '.repeat(this.opts.cols)], options);
    },
    setOptions(patch) {
      Object.assign(this.opts, patch);
    },
    isAnimating(id) {
      return id === undefined ? this.animating.size > 0 : this.animating.has(id);
    },
    onRegionIdle(id, listener) {
      const listeners = this.idle.get(id) ?? new Set();
      listeners.add(listener);
      this.idle.set(id, listeners);
      return () => listeners.delete(listener);
    },
    supportedChars() {
      return manifest.cycle.map((s) => s.char);
    },

    /** Pretend one band's tiles came to rest. Defaults to the main band. */
    settle(id = 'main') {
      this.animating.delete(id);
      for (const listener of [...(this.idle.get(id) ?? [])]) listener();
    },
  };
}

export function setup(t, cols, rows, footerRows) {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const board = stubBoard(cols, rows, footerRows);
  const controller = new Controller(board, { dwellMs: 1000 });
  return { board, controller };
}

