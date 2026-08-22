/**
 * Types for lib/board/theme-pack.mjs. The runtime shape is what validatePack
 * returns; the editor, the loader and the display all speak it.
 */

export type Color = string;

export interface CardStyle {
  fill: Color;
  edge: Color;
  radius: number;
  inset: number;
  sheen: number;
}

export interface HingeStyle {
  fill: Color;
  highlight: Color | null;
  thickness: number;
  pin: Color;
  pinWidth: number;
  pinHeight: number;
}

export interface GlyphStyle {
  fill: Color;
  stroke: Color | null;
  strokeWidth: number;
  /** A CSS font shorthand sized in em, so it scales with the tile. */
  font: string;
  baseline: number;
}

export interface MotionStyle {
  shading: number;
  shadow: number;
  highlight: number;
  perspective: number;
}

export interface StateOverride {
  card?: Partial<CardStyle>;
  glyph?: Partial<GlyphStyle>;
  /** A key into `art`: an image drawn instead of the glyph. */
  art?: string;
}

export interface PackFont {
  family: string;
  src: string;
  weight?: string;
  style?: string;
}

/** A validated, fully-defaulted pack. */
export interface ThemePack {
  id?: string;
  name?: string;
  description: string;
  card: CardStyle;
  hinge: HingeStyle;
  glyph: GlyphStyle;
  motion: MotionStyle;
  states: Record<string, StateOverride>;
  art: Record<string, string>;
  fonts: PackFont[];
}

/** What validatePack accepts: any subset, plus per-state overrides. */
export type PackInput = Partial<Omit<ThemePack, 'card' | 'hinge' | 'glyph' | 'motion'>> & {
  card?: Partial<CardStyle>;
  hinge?: Partial<HingeStyle>;
  glyph?: Partial<GlyphStyle>;
  motion?: Partial<MotionStyle>;
};

export interface RingState {
  name: string;
  char: string;
}

export const DEFAULT_CYCLE: readonly RingState[];
export const PACK_DEFAULTS: Readonly<Pick<ThemePack, 'card' | 'hinge' | 'glyph' | 'motion' | 'fonts'>>;
export const RANGES: Readonly<Record<string, readonly number[]>>;

export function isColor(value: unknown): boolean;
export function validatePack(input: unknown): { ok: true; pack: ThemePack } | { ok: false; errors: string[] };
export function resolveStateStyle(pack: ThemePack, char: string): { card: CardStyle; glyph: GlyphStyle; art: string | null };
export function fontForSize(font: string, size: number): string;
