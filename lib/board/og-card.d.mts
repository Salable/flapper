/** Types for lib/board/og-card.mjs. */

import type { ThemePack } from './theme-pack.mjs';

export interface OgCardBoard {
  name?: string;
  config?: object;
  currentPayload?: { text?: string; rows?: string[] } | null;
}

export interface OgCardData {
  cols: number;
  rows: number;
  /** Exactly `rows` strings of exactly `cols` characters, same contract as layout()'s own pages. */
  grid: string[];
  pack: ThemePack;
}

export function ogCardData(board: OgCardBoard): OgCardData;
