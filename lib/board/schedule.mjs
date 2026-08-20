/**
 * The schedule evaluator: what a scheduled board shows, as a pure function
 * of (items, config, nowMs). The server and every display run this same
 * function against the same server clock, which is why mirrored screens
 * agree without coordinating - there is nothing to coordinate.
 *
 * A schedule spec lives on a queue item (`schedule` jsonb), one of:
 *   {kind:'interval', everyMs}                   anchored at the item's createdAt
 *   {kind:'everyN',   minutes, offsetSec?}       anchored at local midnight (board tz)
 *   {kind:'hourly',   minute, second?}           = everyN 60min, offset minute:second
 *   {kind:'daily',    at:'HH:MM[:SS]'}           wall clock in the board tz
 *   {kind:'weekly',   dow, at}                   dow 0=Sunday..6=Saturday
 *   {kind:'once',     atMs}                      absolute server time
 * plus optional `durationMs`:
 *   undefined -> the item's computed flip+dwell estimate (min 3s)
 *   null      -> until the item's own next trigger (a standing sign that
 *                overlays can interrupt and hand back to)
 *   number    -> exactly that long
 *
 * Pinned semantics (tests/schedule.test.mjs holds these):
 *  - Active = latest trigger <= now, still inside its duration. The winner is
 *    the active item with the latest trigger; when a short overlay expires,
 *    the longer item beneath it resumes (the 9:35 case).
 *  - Exact trigger ties rotate by trigger count, so two items sharing a slot
 *    alternate instead of one shadowing the other forever.
 *  - Timezones are IANA names resolved via Intl only. A wall time erased by
 *    spring-forward fires at the transition instant; a wall time repeated by
 *    fall-back fires at its first occurrence only.
 */

import { reject } from '../api/errors.mjs';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const MIN_SLOT_MS = 3000;

/* ---- timezone plumbing (Intl only) ---- */

const formatters = new Map();

function formatterFor(tz) {
  let dtf = formatters.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, dtf);
  }
  return dtf;
}

/** True when Intl knows the zone; the one validity test we trust. */
export function isTimezone(tz) {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of an instant in a zone. */
function wallOf(tz, ms) {
  const parts = {};
  for (const { type, value } of formatterFor(tz).formatToParts(ms)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/** The wall clock re-encoded as if it were UTC - comparable to Date.UTC input. */
function wallAsUtc(tz, ms) {
  const w = wallOf(tz, ms);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * The UTC instant of a wall-clock time in a zone, with the two pinned DST
 * rules: a repeated time (fall back) resolves to its first occurrence; an
 * erased time (spring forward) fires at the transition instant.
 */
export function zonedToUtc(tz, year, month, day, hour = 0, minute = 0, second = 0) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two offset guesses cover every zone whose offset changed around here.
  const guess1 = asUtc - (wallAsUtc(tz, asUtc) - asUtc);
  const guess2 = asUtc - (wallAsUtc(tz, guess1) - guess1);
  const valid = [...new Set([guess1, guess2])]
    .filter((ms) => wallAsUtc(tz, ms) === asUtc)
    .sort((a, b) => a - b);
  if (valid.length > 0) return valid[0];
  // The gap: the requested wall time never happens. Fire at the transition -
  // binary-search the instant the offset jumps (transitions sit on seconds).
  let lo = Math.min(guess1, guess2);
  let hi = Math.max(guess1, guess2);
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (wallAsUtc(tz, mid) < asUtc) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Local midnight (in tz) of the day containing `ms`, as a UTC instant. */
function midnightOf(tz, ms) {
  const w = wallOf(tz, ms);
  return zonedToUtc(tz, w.year, w.month, w.day, 0, 0, 0);
}

/** Local midnight `deltaDays` away from the day containing `ms`. */
function midnightShift(tz, ms, deltaDays) {
  const w = wallOf(tz, ms);
  const shifted = new Date(Date.UTC(w.year, w.month - 1, w.day + deltaDays));
  return zonedToUtc(
    tz,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
  );
}

function parseAt(at) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(at ?? '');
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]), second: Number(m[3] ?? 0) };
}

/* ---- triggers ---- */

/**
 * The most recent trigger <= now, the earliest trigger > now, and the spec's
 * period (null for once). ctx is {tz, createdAtMs}.
 */
export function triggersOf(schedule, ctx, nowMs) {
  const tz = isTimezone(ctx.tz) ? ctx.tz : 'UTC';
  switch (schedule.kind) {
    case 'once': {
      const at = schedule.atMs;
      return at <= nowMs
        ? { last: at, next: null, period: null }
        : { last: null, next: at, period: null };
    }
    case 'interval': {
      const anchor = ctx.createdAtMs;
      const period = schedule.everyMs;
      if (nowMs < anchor) return { last: null, next: anchor, period };
      const k = Math.floor((nowMs - anchor) / period);
      return { last: anchor + k * period, next: anchor + (k + 1) * period, period };
    }
    case 'hourly':
      return triggersOf(
        {
          kind: 'everyN',
          minutes: 60,
          offsetSec: schedule.minute * 60 + (schedule.second ?? 0),
        },
        ctx,
        nowMs,
      );
    case 'everyN': {
      const period = schedule.minutes * MINUTE;
      const offset = (schedule.offsetSec ?? 0) * 1000;
      // Each day restarts the series at its own local midnight, so ":15 past"
      // holds through DST. Yesterday's series covers the small hours.
      let last = null;
      let next = null;
      for (const delta of [-1, 0, 1]) {
        const start = midnightShift(tz, nowMs, delta) + offset;
        const end = midnightShift(tz, nowMs, delta + 1) + offset;
        if (start > nowMs) {
          if (next === null || start < next) next = start;
          continue;
        }
        const k = Math.floor((nowMs - start) / period);
        const candidate = start + k * period;
        if (candidate < end && (last === null || candidate > last)) last = candidate;
        const following = start + (k + 1) * period;
        if (following < end && (next === null || following < next)) next = following;
      }
      return { last, next, period };
    }
    case 'daily':
    case 'weekly': {
      const { hour, minute, second } = parseAt(schedule.at);
      const step = schedule.kind === 'weekly' ? 7 : 1;
      const w = wallOf(tz, nowMs);
      let last = null;
      let next = null;
      for (let delta = -8; delta <= 8; delta += 1) {
        const day = new Date(Date.UTC(w.year, w.month - 1, w.day + delta));
        if (schedule.kind === 'weekly' && day.getUTCDay() !== schedule.dow) continue;
        const t = zonedToUtc(
          tz,
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          hour,
          minute,
          second,
        );
        if (t <= nowMs) {
          if (last === null || t > last) last = t;
        } else if (next === null || t < next) {
          next = t;
        }
      }
      return { last, next, period: step * DAY };
    }
    default:
      return { last: null, next: null, period: null };
  }
}

/* ---- validation ---- */

const KINDS = ['interval', 'everyN', 'hourly', 'daily', 'weekly', 'once'];

/** Validate a schedule spec from an API body; a named 422 on anything off. */
export function validateSchedule(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    reject('schedule must be an object like {kind: "daily", at: "09:00"}', 422);
  }
  if (!KINDS.includes(spec.kind)) {
    reject(`schedule.kind must be one of ${KINDS.join(', ')}`, 422);
  }
  const out = { kind: spec.kind };
  const intIn = (key, value, lo, hi) => {
    if (!Number.isInteger(value) || value < lo || value > hi) {
      reject(`schedule.${key} must be an integer from ${lo} to ${hi}`, 422);
    }
    return value;
  };
  switch (spec.kind) {
    case 'interval':
      out.everyMs = intIn('everyMs', spec.everyMs, 5000, 7 * DAY);
      break;
    case 'everyN':
      out.minutes = intIn('minutes', spec.minutes, 1, 1440);
      if (spec.offsetSec !== undefined) out.offsetSec = intIn('offsetSec', spec.offsetSec, 0, 86_399);
      break;
    case 'hourly':
      out.minute = intIn('minute', spec.minute, 0, 59);
      if (spec.second !== undefined) out.second = intIn('second', spec.second, 0, 59);
      break;
    case 'daily':
    case 'weekly':
      if (!parseAt(spec.at)) reject('schedule.at must be "HH:MM" or "HH:MM:SS"', 422);
      out.at = spec.at;
      if (spec.kind === 'weekly') out.dow = intIn('dow', spec.dow, 0, 6);
      break;
    case 'once':
      if (!Number.isFinite(spec.atMs) || spec.atMs <= 0) {
        reject('schedule.atMs must be a millisecond timestamp', 422);
      }
      out.atMs = Math.round(spec.atMs);
      break;
    default:
      break;
  }
  if (spec.durationMs !== undefined) {
    if (spec.durationMs === null) {
      out.durationMs = null; // until the next trigger
    } else if (!Number.isFinite(spec.durationMs) || spec.durationMs < 250 || spec.durationMs > DAY) {
      reject('schedule.durationMs must be 250ms to 24h, or null for "until the next trigger"', 422);
    } else {
      out.durationMs = Math.round(spec.durationMs);
    }
  }
  return out;
}

/* ---- evaluation ---- */

function effectiveDuration(item) {
  const d = item.schedule.durationMs;
  if (d === null) return null; // until the item's own next trigger
  return d ?? Math.max(MIN_SLOT_MS, item.computedDurationMs ?? MIN_SLOT_MS);
}

/**
 * What a scheduled board shows at nowMs and when that changes next.
 * config: {timezone, ...}; items need {id, schedule, createdAt, computedDurationMs}.
 * @returns {{item: object|null, nextChangeAtMs: number|null}}
 */
export function evaluate(items, config, nowMs) {
  const tz = config?.timezone ?? 'UTC';
  const infos = [];
  for (const item of items) {
    if (!item.schedule) continue;
    const ctx = { tz, createdAtMs: new Date(item.createdAt ?? 0).getTime() };
    const { last, next, period } = triggersOf(item.schedule, ctx, nowMs);
    const duration = effectiveDuration(item);
    const end = last === null ? null : duration === null ? next : last + duration;
    const active = last !== null && (end === null || nowMs < end);
    infos.push({ item, last, next, period, end, active });
  }

  const actives = infos.filter((info) => info.active);
  let winner = null;
  if (actives.length > 0) {
    const latest = Math.max(...actives.map((info) => info.last));
    const tied = actives.filter((info) => info.last === latest).sort((a, b) => (a.item.id < b.item.id ? -1 : 1));
    // Ties rotate by trigger count so shared slots alternate deterministically
    // on every display (a pure function of the trigger time, not of now).
    const period = tied[0].period;
    const k = period ? Math.floor(latest / period) : 0;
    winner = tied[((k % tied.length) + tied.length) % tied.length];
  }

  let nextChangeAtMs = null;
  const consider = (t) => {
    if (t !== null && t > nowMs && (nextChangeAtMs === null || t < nextChangeAtMs)) {
      nextChangeAtMs = t;
    }
  };
  for (const info of infos) {
    consider(info.next);
    if (info.active) consider(info.end);
  }

  return { item: winner?.item ?? null, nextChangeAtMs };
}

/** The next `count` occurrences of a spec - the editor's preview. */
export function occurrencesAfter(schedule, ctx, nowMs, count = 3) {
  const out = [];
  let cursor = nowMs;
  for (let i = 0; i < count; i += 1) {
    const { next } = triggersOf(schedule, ctx, cursor);
    if (next === null) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/**
 * The materialized end-of-life of a `once` item: after its play window (plus
 * grace for clock skew) it can never show again, so the sweep may drop it.
 * Repeating specs, and open-ended onces, never expire.
 */
export function expiryOf(schedule, computedDurationMs) {
  if (!schedule || schedule.kind !== 'once' || schedule.durationMs === null) return null;
  const duration = schedule.durationMs ?? Math.max(MIN_SLOT_MS, computedDurationMs ?? MIN_SLOT_MS);
  return schedule.atMs + duration + 60_000;
}

/** A human-readable line for a spec - the editor and docs share it. */
export function describeSchedule(schedule) {
  if (!schedule) return 'unscheduled';
  const two = (n) => String(n).padStart(2, '0');
  switch (schedule.kind) {
    case 'interval': {
      const s = schedule.everyMs / 1000;
      const span = s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`;
      return `every ${span}`;
    }
    case 'everyN':
      return `every ${schedule.minutes} min${schedule.offsetSec ? ` (+${schedule.offsetSec}s)` : ''}`;
    case 'hourly':
      return `hourly at :${two(schedule.minute)}${schedule.second ? `:${two(schedule.second)}` : ''}`;
    case 'daily':
      return `daily at ${schedule.at}`;
    case 'weekly':
      return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][schedule.dow]} at ${schedule.at}`;
    case 'once':
      return `once at ${new Date(schedule.atMs).toISOString()}`;
    default:
      return schedule.kind;
  }
}
