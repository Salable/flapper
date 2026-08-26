/** Types for lib/board/theme-editor.mjs. */
import type { ThemePack, PackInput } from './theme-pack.mjs';
import type { ThemeConfig } from './board-theme.mjs';

export interface ThemeDraft {
  theme: string;
  pack: ThemePack;
}

export interface FontChoice {
  id: string;
  label: string;
  stack: string;
}

export interface ParsedFont {
  weight: string;
  size: number;
  family: string | null;
  stack: string;
}

export const FONT_CHOICES: readonly FontChoice[];
export const FONT_WEIGHTS: readonly string[];

export function presetDraft(themeId?: string): ThemeDraft;
export function draftFromConfig(config: ThemeConfig | null | undefined): ThemeDraft;
export function setDraftField(draft: ThemeDraft, path: string, value: unknown): ThemeDraft;
export function artKeyFor(char: string): string | null;
export function setStateField(draft: ThemeDraft, char: string, path: string, value: unknown): ThemeDraft;
export function attachArt(draft: ThemeDraft, char: string, dataUri: string): ThemeDraft;
export function detachArt(draft: ThemeDraft, char: string): ThemeDraft;
export function clearState(draft: ThemeDraft, char: string): ThemeDraft;
export function parseFont(font: string): ParsedFont;
export function buildFont(font: { weight: string; size: number; family: string | null; stack?: string }): string;
export function setGlyphFont(draft: ThemeDraft, change: Partial<ParsedFont>): ThemeDraft;
export function buildFlight(colours: readonly string[]): (string | null)[] | null;
export function paletteOfFlight(flight: readonly (string | null)[] | null | undefined): string[];
export function setFlightPalette(draft: ThemeDraft, colours: readonly string[]): ThemeDraft;
export function draftToPatch(draft: ThemeDraft): { ok: true; theme: string; themePack: PackInput | null } | { ok: false; errors: string[] };
export function savedPatch(config: ThemeConfig | null | undefined): { theme: string; themePack: PackInput | null };
