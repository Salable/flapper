/**
 * Client-side mirror of lib/board-types/index.mjs: which client pieces each
 * type ships. Pure data (importable under node --test); the thunks are only
 * invoked in the browser. The contract harness asserts this list matches the
 * server registry exactly.
 */

import type { ThemePack } from '@/lib/board/theme-pack.mjs';

/**
 * What every type-specific queue editor is handed. The slug alone was enough
 * while these editors were lists and forms; it stopped being enough once they
 * were expected to show the board they are editing (a `ThemePreview` needs the
 * design, the grid and the screen). Same five values SettingsClient already
 * passes QueueManager, for the same reason - an editor should show its board,
 * not describe it.
 */
export type BoardTypeEditorProps = {
  slug: string;
  /** The board's own resolved design, so a preview wears what the glass wears. */
  pack: ThemePack;
  cols: number;
  rows: number;
  /** The board's true screen ratio - see ThemePreview's doc on `screenAspect`. */
  screenAspect?: number;
  /** The board's Fidget setting, so a still preview isn't a lie. */
  ambientMs?: number;
};

export type BoardTypeClient = {
  id: string;
  /** Extra queue-tab UI (e.g. a schedule editor); null = the generic queue list. */
  queueEditor: null | (() => Promise<{ default: React.ComponentType<BoardTypeEditorProps> }>);
};

export const BOARD_TYPE_CLIENTS: BoardTypeClient[] = [
  { id: 'live', queueEditor: null },
  { id: 'scheduled', queueEditor: () => import('./scheduled/ScheduleEditor') },
  { id: 'shared', queueEditor: () => import('./shared/SharedQueueEditor') },
];
