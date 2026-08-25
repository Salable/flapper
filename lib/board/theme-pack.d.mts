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

/**
 * How the physical board moves: the flip's mechanical feel, and how long a
 * message sits once landed. `advanced` for now - see TODO.md, "Board motion
 * belongs to the design".
 */
export interface AdvancedStyle {
  /** How long a message holds once landed, in ms. */
  dwellMs: number;
  /** Duration of a step while a tile is mid-flip, in ms. */
  fastStepMs: number;
  /** Duration of a tile's final, landing step, in ms. */
  landStepMs: number;
  /** Repaint at most this often, in ms; 0 is uncapped. Lower reads as more mechanical. */
  frameMs: number;
  /** Total stagger across the whole board when many tiles flip together, in ms. */
  sweepMs: number;
  /** The pattern the stagger follows across the grid. */
  staggerMode: 'none' | 'column' | 'row' | 'diagonal' | 'random';
  /** Force every tile through a full revolution, even when unchanged. */
  alwaysFlip: boolean;
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

/** A wash across the grid: a colour per cell, stored as the formula. */
export interface TintGradient {
  from: string;
  to: string;
  /** Degrees clockwise from left-to-right. 0 across, 90 down, 45 corner to corner. */
  angle?: number;
}

/** A colour in each corner, blended across the grid in both directions. */
export interface TintCorners {
  tl: string;
  tr: string;
  bl: string;
  br: string;
}

/** A light travelling round the perimeter, with a fading tail. */
export interface TintRunner {
  colour: string;
  /** Cards lit behind the head. */
  length?: number;
  /** One lap, in milliseconds. At least 1000. */
  periodMs?: number;
}

/**
 * A wash: exactly one of `gradient`, `corners` or `runner`. The renderer
 * prefers them in that reverse order (runner, corners, gradient), and the
 * editor writes one kind at a time - so a spec carrying two is a bug, not a
 * blend.
 */
export interface Tint {
  gradient?: TintGradient;
  corners?: TintCorners;
  runner?: TintRunner;
  /** How the colour lands on the card. `overlay` protects black and white glyphs. */
  mode?: 'overlay' | 'wash' | 'multiply' | 'screen';
  /** 0 to 1. */
  strength?: number;
  /** The whole wash rotating in hue. One turn per `periodMs`, at least 1000. */
  drift?: { periodMs: number } | null;
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
  advanced: AdvancedStyle;
  states: Record<string, StateOverride>;
  art: Record<string, string>;
  fonts: PackFont[];
  tint: Tint | null;
  /**
   * Colours a tile passes through on its way, by ring position, applied only
   * while it is moving. `null` in the sequence means the base card.
   */
  flight: (string | null)[] | null;
  /** How strongly the flight colours apply, 0 to 1. */
  flightStrength: number;
}

/** What validatePack accepts: any subset, plus per-state overrides. */
export type PackInput = Partial<Omit<ThemePack, 'card' | 'hinge' | 'glyph' | 'motion' | 'advanced'>> & {
  card?: Partial<CardStyle>;
  hinge?: Partial<HingeStyle>;
  glyph?: Partial<GlyphStyle>;
  motion?: Partial<MotionStyle>;
  advanced?: Partial<AdvancedStyle>;
};

export interface RingState {
  name: string;
  char: string;
}

export const DEFAULT_CYCLE: readonly RingState[];
export const PACK_DEFAULTS: Readonly<Pick<ThemePack, 'card' | 'hinge' | 'glyph' | 'motion' | 'advanced' | 'fonts'>>;
export const STAGGER_MODES: readonly AdvancedStyle['staggerMode'][];
export const RANGES: Readonly<Record<string, readonly number[]>>;

export function isColor(value: unknown): boolean;
export function validatePack(input: unknown): { ok: true; pack: ThemePack } | { ok: false; errors: string[] };
export function resolveStateStyle(pack: ThemePack, char: string): { card: CardStyle; glyph: GlyphStyle; art: string | null };
export function fontForSize(font: string, size: number): string;
