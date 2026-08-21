/**
 * The scheduled board: a clock, not a queue. Every item carries a schedule
 * spec; the board shows whichever item the clock says is active, and the
 * fallback message in the gaps between. Playback is a pure function of the
 * server clock (lib/board/schedule.mjs), so every screen showing this board
 * agrees without coordinating.
 *
 * Server-safe AND client-safe: the display player imports this module to run
 * the same evaluation the server does. Import only pure lib/ modules here.
 */

import {
  evaluate,
  validateSchedule,
  isTimezone,
  MIN_SLOT_MS,
} from '../../board/schedule.mjs';
import { reject } from '../../api/errors.mjs';

/** The standing item shown between scheduled slots, synthesized from config. */
function fallbackItem(config) {
  const text = (config?.fallback ?? '').trim();
  if (text === '') return null;
  return {
    id: '__fallback',
    updatedAt: 0,
    payload: { text, options: {} },
  };
}

export default {
  id: 'scheduled',
  name: 'Scheduled',
  tagline: 'Messages on a clock, down to the second.',
  description:
    'Every message carries a schedule - every N minutes, hourly at :15, daily ' +
    'at 09:00, or once at an exact moment. The board shows whatever the clock ' +
    'says is active and a fallback message in the gaps. All screens follow the ' +
    'server clock, so what plays never depends on who is watching.',
  capabilities: ['Runs on the clock', 'To the second', 'Fallback between slots'],
  sample: 'STANDUP 0900',
  configVersion: 1,
  migrateConfig(config) {
    return config;
  },
  createParams: [
    { key: 'name', kind: 'text', label: 'Board name', maxLength: 80, default: '' },
    {
      key: 'timezone',
      kind: 'text',
      label: 'Timezone (IANA, e.g. Europe/London)',
      maxLength: 64,
      default: 'UTC',
    },
    {
      key: 'fallback',
      kind: 'message',
      label: 'Fallback message (between slots; blank = dark glass)',
      maxLength: 400,
      default: '',
    },
  ],
  itemParams: [],
  /** Wall-clock params must actually resolve; a typoed zone fails loudly. */
  validateConfig(config) {
    if (config.timezone !== undefined && !isTimezone(config.timezone)) {
      reject(`"${config.timezone}" is not an IANA timezone (try Europe/London or UTC)`, 422);
    }
  },
  queuePolicy: {
    cap: () => 100,
    onFull: 'reject',
    /** Flushing a scheduled board clears the whole schedule. */
    isPending: () => true,
  },
  playback: 'clock',
  fallbackItem,
  /**
   * now/next/normal on a clock board become `once` specs: now = this instant,
   * next = when the current slot changes. A body may carry an explicit
   * schedule instead; loop is meaningless here and is dropped.
   */
  ingest(priority, entry, { snapshot, config, nowMs }) {
    let schedule = entry.schedule !== undefined && entry.schedule !== null
      ? validateSchedule(entry.schedule)
      : null;
    if (!schedule) {
      let atMs = nowMs;
      if (priority === 'next') {
        const { nextChangeAtMs } = evaluate(snapshot?.items ?? [], config, nowMs);
        atMs = nextChangeAtMs ?? nowMs;
      }
      schedule = { kind: 'once', atMs };
    }
    return { entry: { ...entry, loop: false, schedule }, placement: 'append' };
  },
  /** The pure playback decision every screen runs. */
  itemAt(items, fallback, config, nowMs) {
    const { item, nextChangeAtMs } = evaluate(items, config, nowMs);
    return {
      item: item ?? fallback ?? null,
      isFallback: item === null,
      nextChangeAtMs,
    };
  },
  /** Merged into GET /queue so /status callers and the editor see the clock. */
  snapshotExtras(board, snapshot, nowMs) {
    const { item, nextChangeAtMs } = evaluate(snapshot.items ?? [], board.config ?? {}, nowMs);
    return {
      activeItemId: item?.id ?? null,
      onFallback: item === null,
      nextChangeAtMs,
      minSlotMs: MIN_SLOT_MS,
    };
  },
};
