/**
 * Client-side mirror of lib/board-types/index.mjs: which client pieces each
 * type ships. Pure data (importable under node --test); the thunks are only
 * invoked in the browser. The contract harness asserts this list matches the
 * server registry exactly.
 */

export type BoardTypeClient = {
  id: string;
  /** Extra queue-tab UI (e.g. a schedule editor); null = the generic queue list. */
  queueEditor: null | (() => Promise<{ default: React.ComponentType<{ slug: string }> }>);
};

export const BOARD_TYPE_CLIENTS: BoardTypeClient[] = [
  { id: 'live', queueEditor: null },
  { id: 'scheduled', queueEditor: () => import('./scheduled/ScheduleEditor') },
];
