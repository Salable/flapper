/**
 * The board's control plane: one track per band, one way in.
 *
 * Every source of text - the local UI, the REST API, the built-in playlist -
 * enqueues through here, so nothing can fight over the board. The controller
 * itself holds no queue; it routes to the `Track` that owns the band the
 * message is addressed to, and owns the things that are genuinely board-wide:
 * geometry, motion, and the aggregate view of what is happening.
 *
 * It lives in the renderer rather than the main process because that is where
 * the board is. Page advancement keys off a band settling, which is a local
 * callback; routing it through IPC would add a round-trip per page for nothing.
 * The main process owns the socket and forwards requests here.
 */

import { MOTION_DEFAULTS } from '../shared/timing.mjs';
import { MAIN, FOOTER } from '../shared/regions.mjs';
import { Track, TRACK_DEFAULTS, PRIORITIES } from './track.mjs';

export const CONTROLLER_DEFAULTS = Object.freeze({ ...TRACK_DEFAULTS });
export { PRIORITIES, MAIN, FOOTER };

export class Controller {
  /**
   * @param {import('./flipboard.js').Flipboard} board
   * @param {object} [options]
   */
  constructor(board, options = {}) {
    this.board = board;
    this.opts = { ...CONTROLLER_DEFAULTS, ...options };

    this.nextId = 1;
    this.tracks = new Map();
    /**
     * Per-band settings that are not the board's own. Held here rather than on
     * the track so an override survives its band being configured away and
     * back - dragging the footer to zero and up again while fiddling should not
     * silently lose it.
     * @type {Map<string, {dwellMs?: number}>}
     */
    this.bandOpts = new Map();
    /** Called on any state change, for pushing to API listeners. */
    this.onChange = null;

    this.syncTracks();
  }

  /* ---- tracks ---- */

  /**
   * Bring the set of tracks in line with the board's bands. Called on
   * construction and after any geometry change, since configuring a footer to
   * zero rows removes the band entirely.
   */
  syncTracks() {
    for (const region of this.board.regions) {
      if (this.tracks.has(region.id)) continue;
      const track = new Track(this.board, region.id, {
        ...this.opts,
        allocateId: () => `m${this.nextId++}`,
      });
      track.onChange = () => this.changed();
      this.tracks.set(region.id, track);
    }
    for (const [id, track] of [...this.tracks]) {
      if (this.board.region(id)) continue;
      track.dispose();
      this.tracks.delete(id);
    }
    this.applyDwell();
  }

  /** The hold for a band: its own if it has one, else the board's. */
  dwellFor(regionId) {
    const own = this.bandOpts.get(regionId)?.dwellMs;
    return own === undefined ? this.opts.dwellMs : own;
  }

  /** Push the effective hold onto each track, so `Track` needs no notion of it. */
  applyDwell() {
    for (const [id, track] of this.tracks) track.opts.dwellMs = this.dwellFor(id);
  }

  /** The track for a band, or a 422 naming the ones that exist. */
  track(regionId = MAIN) {
    const track = this.tracks.get(regionId);
    if (!track) {
      const known = [...this.tracks.keys()].join(', ');
      const error = new Error(`unknown region: ${regionId}. this board has ${known}`);
      error.status = 422;
      throw error;
    }
    return track;
  }

  /** The main track's queue and current message, for convenience and tests. */
  get queue() {
    return this.track(MAIN).queue;
  }

  get current() {
    return this.track(MAIN).current;
  }

  /* ---- routing ---- */

  enqueue(text, options = {}) {
    return this.track(options.region ?? MAIN).enqueue(text, options);
  }

  preview(text, options = {}) {
    return this.track(options.region ?? MAIN).preview(text, options);
  }

  /**
   * Drop everything not yet started. With no region, every band - so a bare
   * flush still means what it always did on a board with one band.
   */
  flush(regionId) {
    return this.eachTrack(regionId).reduce((total, track) => total + track.flush(), 0);
  }

  /** Stop everything and blank. With no region, every band. */
  clear(regionId) {
    return this.eachTrack(regionId).reduce((total, track) => total + track.clear(), 0);
  }

  eachTrack(regionId) {
    return regionId === undefined ? [...this.tracks.values()] : [this.track(regionId)];
  }

  /* ---- introspection ---- */

  status() {
    const main = this.track(MAIN).status();
    const regions = {};
    for (const [id, track] of this.tracks) {
      // `dwellMs` is the effective hold; `dwellOverride` says whether the band
      // set it or inherited it, which is what a reset affordance needs.
      regions[id] = { ...track.status(), dwellOverride: this.bandOpts.get(id)?.dwellMs ?? null };
    }

    const { cols, rows, align, valign, wrap } = this.board.opts;
    return {
      // The top level describes the main band, so a client that has never heard
      // of regions sees exactly what it saw before.
      showing: main.showing,
      lines: this.board.page ?? null,
      animating: this.board.isAnimating(),
      queue: main.queue,
      regions,
      grid: {
        cols,
        rows,
        align,
        valign,
        wrap,
        // The effective height, not what was asked for: a footer is clamped to
        // leave the main band a row, and the panel should mirror the truth.
        footerRows: this.board.regionHeight(FOOTER),
        mainRows: this.board.mainHeight,
      },
      motion: pick(this.board.opts, Object.keys(MOTION_DEFAULTS)),
      dwellMs: this.opts.dwellMs,
    };
  }

  capabilities() {
    return {
      charset: this.board.supportedChars().join(''),
      states: this.board.states,
      tileSize: this.board.tileSize,
      grid: {
        cols: this.board.opts.cols,
        rows: this.board.opts.rows,
        footerRows: this.board.regionHeight(FOOTER),
        mainRows: this.board.mainHeight,
      },
      regions: [...this.tracks.keys()],
      maxFooterRows: Math.max(0, this.board.opts.rows - 1),
      align: ['left', 'center', 'right'],
      valign: ['top', 'middle', 'bottom'],
      wrap: ['word', 'char', 'none'],
      staggerModes: ['none', 'column', 'row', 'diagonal', 'random'],
      priority: [...PRIORITIES],
      // An older build silently ignores an option it does not know, so a caller
      // has no other way to tell whether these are here.
      repeat: true,
      perBandDwell: true,
      maxDwellMs: 600000,
      maxQueue: this.opts.maxQueue,
    };
  }

  /** Change grid geometry, bands, motion, or dwell. Redraws what is showing. */
  configure(patch = {}) {
    const boardKeys = [
      'cols',
      'rows',
      'footerRows',
      'align',
      'valign',
      'wrap',
      'alwaysFlip',
      'padding',
      'gapRatio',
      ...Object.keys(MOTION_DEFAULTS),
    ];
    const forBoard = pick(patch, boardKeys);

    // Measured, not requested: a footer is clamped against the grid height, so
    // asking for more rows than exist must not read as a change.
    const before = { cols: this.board.opts.cols, heights: this.bandHeights() };

    if (Object.keys(forBoard).length > 0) this.board.setOptions(forBoard);
    this.syncTracks();

    // Dwell is resolved after the bands are, so one call can both create a band
    // and set its hold.
    if ('dwellMs' in patch) {
      const dwell = clampNumber(patch.dwellMs, 0, 600000);
      // Note this no longer stamps every track: a band with its own hold keeps
      // it when the board default moves.
      if (dwell !== undefined) this.opts.dwellMs = dwell;
    }
    if (patch.regions !== undefined) this.configureBands(patch.regions);
    this.applyDwell();

    const after = { cols: this.board.opts.cols, heights: this.bandHeights() };
    const geometryChanged =
      before.cols !== after.cols ||
      before.heights.size !== after.heights.size ||
      [...after.heights].some(([id, height]) => before.heights.get(id) !== height);

    // New geometry invalidates every laid-out page, in every band.
    if (geometryChanged) {
      for (const track of this.tracks.values()) track.reflow();
    }

    this.changed();
    return this.status();
  }

  /**
   * Apply per-band settings. `null` hands a setting back to the board default
   * rather than pinning it to zero.
   */
  configureBands(regions) {
    if (regions === null || typeof regions !== 'object' || Array.isArray(regions)) {
      const error = new Error('regions must be an object keyed by region id');
      error.status = 422;
      throw error;
    }
    for (const [id, band] of Object.entries(regions)) {
      this.track(id); // 422 naming the bands that do exist
      if (band === null || typeof band !== 'object') continue;
      if (!('dwellMs' in band)) continue;

      const entry = this.bandOpts.get(id) ?? {};
      if (band.dwellMs === null) delete entry.dwellMs;
      else {
        const dwell = clampNumber(band.dwellMs, 0, 600000);
        if (dwell !== undefined) entry.dwellMs = dwell;
      }
      this.bandOpts.set(id, entry);
    }
  }

  bandHeights() {
    return new Map(this.board.regions.map((region) => [region.id, region.height]));
  }

  changed() {
    if (this.onChange) this.onChange(this.status());
  }
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
}
