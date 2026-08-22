/** Types for lib/board/board-theme.mjs. */
import type { ThemePack, PackInput } from './theme-pack.mjs';

export interface ThemeConfig {
  theme?: string;
  themePack?: PackInput | null;
}

export const THEME_LIMITS: Readonly<{ maxBytes: number; maxArts: number; maxArtBytes: number; artTypes: readonly string[] }>;

export function stableStringify(value: unknown): string;
export function mergePack(preset: ThemePack, sparse: PackInput | null | undefined): PackInput;
export function sparsify(full: ThemePack, preset: ThemePack): PackInput | null;
export function checkThemePackLimits(sparse: unknown): { ok: true } | { ok: false; errors: string[]; tooLarge: boolean };
export function resolveBoardTheme(config: ThemeConfig | null | undefined): {
  id: string;
  pack: ThemePack;
  themePack: PackInput | null;
  warnings: string[];
};
export function normalizeThemePatch(
  patch: ThemeConfig,
  current?: ThemeConfig,
): { ok: true; themePack?: PackInput | null } | { ok: false; errors: string[]; tooLarge: boolean };
export function publicConfig<T>(config: T): T;
export function themeRevOf(config: ThemeConfig | null | undefined): Promise<string>;
export function themeCapabilities(ranges: unknown): Record<string, unknown>;
