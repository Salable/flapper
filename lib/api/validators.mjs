/**
 * Request validation, ported from the desktop server.
 *
 * The philosophy is unchanged: reject, don't ignore. An option that does not
 * apply gets a 422 naming the field and why; silently dropping it reads as a
 * bug from the caller's side. Shape is checked here; whether a band exists is
 * the board's to answer, since only it knows the current geometry.
 */

import { reject } from './errors.mjs';
import { isTheme, THEME_IDS } from '../board/themes.mjs';

export const LIMITS = Object.freeze({
  maxBodyBytes: 256 * 1024,
  maxTextLength: 20000,
  maxRows: 200,
});

/**
 * `rows` gives direct, cell-level control: one string per board row, taken
 * literally with no wrapping, alignment, or pagination.
 */
export function rowsOption(body, limits = LIMITS) {
  const { rows } = body;
  if (rows === undefined) return undefined;
  if (!Array.isArray(rows)) reject('rows must be an array of strings', 422);
  if (rows.length > limits.maxRows) {
    reject(`rows exceeds ${limits.maxRows} entries`, 413);
  }
  let total = 0;
  for (const row of rows) {
    if (row !== null && typeof row !== 'string') {
      reject('each entry in rows must be a string or null', 422);
    }
    total += row === null ? 0 : row.length;
  }
  if (total > limits.maxTextLength) {
    reject(`rows exceed ${limits.maxTextLength} characters in total`, 413);
  }
  return rows;
}

const PRIORITIES = ['normal', 'next', 'now'];

/**
 * Where the message lands in the queue. Rejected on preview bodies, which never
 * queue anything, so a caller who expects a jump is told rather than ignored.
 */
export function priorityOption(body) {
  if (body.priority === undefined) return undefined;
  if (!PRIORITIES.includes(body.priority)) {
    reject(`priority must be one of ${PRIORITIES.join(', ')}`, 422);
  }
  return body.priority;
}

/** Which band of the board to address. Shape only. */
export function regionOption(body) {
  if (body.region === undefined) return undefined;
  if (typeof body.region !== 'string' || body.region.trim() === '') {
    reject('region must be a non-empty string', 422);
  }
  return body.region;
}

/**
 * Whether a message rejoins its band's queue when it finishes.
 *
 * Strictly boolean, unlike `collapseSpaces` next door which coerces. The
 * failure modes are not comparable: a coerced `"false"` here means a board that
 * cycles forever with no way to stop it short of clearing the band.
 */
export function repeatOption(body) {
  if (body.repeat === undefined) return undefined;
  if (typeof body.repeat !== 'boolean') reject('repeat must be true or false', 422);
  return body.repeat;
}

/** Text and layout options accepted on message and preview bodies. */
export function textOptions(body, limits = LIMITS) {
  const text = body.text === undefined ? '' : String(body.text);
  if (text.length > limits.maxTextLength) {
    reject(`text exceeds ${limits.maxTextLength} characters`, 413);
  }

  const options = {};
  const rows = rowsOption(body, limits);
  if (rows !== undefined) {
    options.rows = rows;
    // Silently ignoring these would look like a bug from the caller's side.
    for (const key of ['align', 'valign', 'wrap', 'collapseSpaces']) {
      if (body[key] !== undefined) {
        reject(`${key} does not apply when rows is given; rows are taken literally`, 422);
      }
    }
    if (body.dwellMs !== undefined) {
      const dwell = Number(body.dwellMs);
      if (!Number.isFinite(dwell) || dwell < 0) reject('dwellMs must be a non-negative number', 422);
      options.dwellMs = dwell;
    }
    if (body.substitutions !== undefined) {
      if (typeof body.substitutions !== 'object' || body.substitutions === null) {
        reject('substitutions must be an object', 422);
      }
      options.substitutions = body.substitutions;
    }
    const rowsPriority = priorityOption(body);
    if (rowsPriority !== undefined) options.priority = rowsPriority;
    const rowsRegion = regionOption(body);
    if (rowsRegion !== undefined) options.region = rowsRegion;
    const rowsRepeat = repeatOption(body);
    if (rowsRepeat !== undefined) options.repeat = rowsRepeat;
    return { text, options };
  }
  for (const [key, allowed] of [
    ['align', ['left', 'center', 'right']],
    ['valign', ['top', 'middle', 'bottom']],
    ['wrap', ['word', 'char', 'none']],
  ]) {
    if (body[key] !== undefined) {
      if (!allowed.includes(body[key])) {
        reject(`${key} must be one of ${allowed.join(', ')}`, 422);
      }
      options[key] = body[key];
    }
  }
  if (body.dwellMs !== undefined) {
    const dwell = Number(body.dwellMs);
    if (!Number.isFinite(dwell) || dwell < 0) {
      reject('dwellMs must be a non-negative number', 422);
    }
    options.dwellMs = dwell;
  }
  if (body.collapseSpaces !== undefined) options.collapseSpaces = Boolean(body.collapseSpaces);
  if (body.substitutions !== undefined) {
    if (typeof body.substitutions !== 'object' || body.substitutions === null) {
      reject('substitutions must be an object', 422);
    }
    options.substitutions = body.substitutions;
  }
  const priority = priorityOption(body);
  if (priority !== undefined) options.priority = priority;
  const region = regionOption(body);
  if (region !== undefined) options.region = region;
  const repeat = repeatOption(body);
  if (repeat !== undefined) options.repeat = repeat;
  return { text, options };
}

/** The config patch a PATCH /config body may carry. */
export function validateConfigPatch(body) {
  // A theme the build does not ship is refused, not defaulted: a display
  // would silently fall back to classic and the caller would never know.
  if (body.theme !== undefined && !isTheme(body.theme)) {
    reject(`theme must be one of ${THEME_IDS.join(', ')}`, 422);
  }
  // The board clamps a footer to leave the queue a row, but a nonsense value
  // should be refused outright rather than silently becoming something else.
  if (body.footerRows !== undefined) {
    // `null` is refused explicitly: Number(null) is 0, so it would otherwise
    // pass this check and silently turn the footer off.
    const rows = body.footerRows === null ? NaN : Number(body.footerRows);
    if (!Number.isInteger(rows) || rows < 0) {
      reject('footerRows must be a non-negative integer', 422);
    }
  }
  if (body.regions !== undefined) {
    const bands = body.regions;
    if (bands === null || typeof bands !== 'object' || Array.isArray(bands)) {
      reject('regions must be an object keyed by region id', 422);
    }
    for (const [id, band] of Object.entries(bands)) {
      if (band === null || typeof band !== 'object' || Array.isArray(band)) {
        reject(`regions.${id} must be an object`, 422);
      }
      for (const key of Object.keys(band)) {
        // Refused rather than ignored: a typo that quietly does nothing is the
        // worst outcome, and this is where per-band align or wrap would land.
        if (key !== 'dwellMs') reject(`regions.${id}.${key} is not a per-band setting`, 422);
      }
      if ('dwellMs' in band && band.dwellMs !== null) {
        const dwell = Number(band.dwellMs);
        if (!Number.isFinite(dwell) || dwell < 0) {
          reject(`regions.${id}.dwellMs must be a non-negative number or null`, 422);
        }
      }
    }
  }
  return body;
}
