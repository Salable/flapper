/**
 * A board's own theme: a preset plus the board's overrides.
 *
 * Board config carries `theme` (a preset id, lib/board/themes.mjs) and an
 * optional `themePack` - the *sparse* set of pack fields the board changes.
 * The full pack a display draws is the preset with those overrides merged
 * in. Every side of the system resolves it with the same function here:
 * the API when it validates a patch, the server page for the display's
 * first paint, the display when the config changes, the settings editor
 * for its preview.
 *
 * Two rules keep the stored shape small and honest:
 *
 * - The merge is one level deep for `card`/`hinge`/`glyph`/`motion`, and
 *   `states`/`art`/`fonts` replace wholesale. No tombstones: to drop a
 *   preset's state override you send the states you want.
 * - The server never stores what it was sent. It merges, validates, and
 *   stores the *difference* from the preset (`sparsify`), so a caller that
 *   sends a whole pack and one that sends a diff end up with the same row,
 *   and "reset to preset" is the empty diff: `themePack: null`.
 *
 * Limits live here too (`THEME_LIMITS`) because three callers enforce them
 * - the validator, /capabilities, and the editor - and they must agree.
 *
 * Pure and client-safe.
 */

import { validatePack, DEFAULT_CYCLE } from './theme-pack.mjs';
import { resolveTheme, THEMES } from './themes.mjs';

export const THEME_LIMITS = Object.freeze({
  /** Serialised size of the stored (sparse) pack. */
  maxBytes: 64 * 1024,
  /** Inline art entries, and the decoded size of each. */
  maxArts: 8,
  maxArtBytes: 16 * 1024,
  artTypes: Object.freeze(['image/png', 'image/webp']),
});

const SECTIONS = Object.freeze(['card', 'hinge', 'glyph', 'motion']);
const PACK_KEYS = new Set([...SECTIONS, 'states', 'art', 'fonts']);
/** Identity travels with a resolved pack (get_theme hands it out); sending it back is harmless. */
const IDENTITY_KEYS = new Set(['id', 'name', 'description']);

/** Base64 prefixes of the two image formats we accept, by declared MIME. */
const MAGIC = { 'image/png': 'iVBORw0KGgo', 'image/webp': 'UklGR' };

/** JSON with keys in a stable order, so equal packs hash equal. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function same(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/** Preset fields plus the board's overrides, as input for validatePack. */
export function mergePack(preset, sparse) {
  const merged = {
    id: preset.id,
    name: preset.name,
    description: preset.description,
  };
  for (const section of SECTIONS) {
    merged[section] = { ...preset[section], ...(sparse?.[section] || {}) };
  }
  merged.states = sparse?.states !== undefined ? sparse.states : preset.states;
  merged.art = sparse?.art !== undefined ? sparse.art : preset.art;
  merged.fonts = sparse?.fonts !== undefined ? sparse.fonts : preset.fonts;
  return merged;
}

/**
 * What a validated full pack changes relative to its preset - the thing
 * the server stores. `null` when nothing differs. Art nothing refers to is
 * dropped, so an upload a user then un-assigned does not ride along.
 */
export function sparsify(full, preset) {
  const out = {};
  for (const section of SECTIONS) {
    const diff = {};
    for (const [key, value] of Object.entries(full[section] || {})) {
      if (!same(value, preset[section]?.[key])) diff[key] = value;
    }
    if (Object.keys(diff).length) out[section] = diff;
  }
  const states = full.states || {};
  if (!same(states, preset.states || {})) out.states = states;
  const referenced = new Set(Object.values(states).map((s) => s.art).filter(Boolean));
  const art = Object.fromEntries(Object.entries(full.art || {}).filter(([key]) => referenced.has(key)));
  if (!same(art, preset.art || {})) out.art = art;
  if (!same(full.fonts || [], preset.fonts || [])) out.fonts = full.fonts;
  return Object.keys(out).length ? out : null;
}

/** Decoded byte count of a base64 data URI, without decoding it. */
function dataUriBytes(uri) {
  const comma = uri.indexOf(',');
  const payload = comma < 0 ? '' : uri.slice(comma + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/**
 * The checks a *board's* override must pass before merging: shape and
 * size. Returns `{ ok }` or `{ ok: false, errors, tooLarge }` - `tooLarge`
 * is the 413 case, everything else is a 422.
 */
export function checkThemePackLimits(sparse) {
  const errors = [];
  let tooLarge = false;
  if (sparse === null || sparse === undefined) return { ok: true };
  if (typeof sparse !== 'object' || Array.isArray(sparse)) {
    return { ok: false, errors: ['themePack must be an object or null'], tooLarge };
  }
  for (const key of Object.keys(sparse)) {
    if (!PACK_KEYS.has(key) && !IDENTITY_KEYS.has(key)) errors.push(`themePack.${key} is not a pack field`);
  }
  const bytes = JSON.stringify(sparse).length;
  if (bytes > THEME_LIMITS.maxBytes) {
    errors.push(`themePack is ${bytes} bytes; limit is ${THEME_LIMITS.maxBytes}`);
    tooLarge = true;
  }
  const art = sparse.art && typeof sparse.art === 'object' ? Object.entries(sparse.art) : [];
  if (art.length > THEME_LIMITS.maxArts) {
    errors.push(`themePack.art has ${art.length} entries; limit is ${THEME_LIMITS.maxArts}`);
    tooLarge = true;
  }
  for (const [key, value] of art) {
    if (typeof value !== 'string' || !value.startsWith('data:')) continue; // paths are checked by validatePack
    const match = /^data:(image\/(?:png|webp));base64,(.*)$/s.exec(value);
    if (!match) {
      errors.push(`themePack.art.${key} must be a base64 data:image/png or data:image/webp URI`);
      continue;
    }
    const [, mime, payload] = match;
    if (!payload.startsWith(MAGIC[mime])) {
      errors.push(`themePack.art.${key} does not look like ${mime}`);
    }
    const size = dataUriBytes(value);
    if (size > THEME_LIMITS.maxArtBytes) {
      errors.push(`themePack.art.${key} is ${size} bytes decoded; limit is ${THEME_LIMITS.maxArtBytes}`);
      tooLarge = true;
    }
  }
  return errors.length ? { ok: false, errors, tooLarge } : { ok: true };
}

/**
 * Resolve a board's config to the pack its displays draw.
 *
 * Never throws. A stored override that no longer validates (a preset
 * changed under it, a limit tightened) falls back to the preset and says
 * so in `warnings`, so a wall keeps showing the message in the wrong
 * colour rather than nothing.
 *
 * @returns {{ id: string, pack: object, themePack: object|null, warnings: string[] }}
 */
export function resolveBoardTheme(config) {
  const preset = resolveTheme(config?.theme);
  const sparse = config?.themePack ?? null;
  if (sparse === null) return { id: preset.id, pack: preset, themePack: null, warnings: [] };
  const limits = checkThemePackLimits(sparse);
  if (!limits.ok) return { id: preset.id, pack: preset, themePack: null, warnings: limits.errors };
  const result = validatePack(mergePack(preset, sparse));
  if (!result.ok) return { id: preset.id, pack: preset, themePack: null, warnings: result.errors };
  const pack = { ...result.pack, id: preset.id, name: preset.name, description: preset.description };
  return { id: preset.id, pack, themePack: sparsify(pack, preset), warnings: [] };
}

/**
 * Validate a config patch's theme fields against the board's current config
 * and return what to store: `{ theme, themePack }` with `themePack` already
 * sparsified (or `null`). Throws nothing; returns `{ ok: false, errors,
 * tooLarge }` for the caller to turn into a status.
 */
export function normalizeThemePatch(patch, current = {}) {
  const theme = patch.theme !== undefined ? patch.theme : current.theme;
  const preset = resolveTheme(theme);
  if (patch.themePack === undefined) return { ok: true };
  if (patch.themePack === null) return { ok: true, themePack: null };
  const limits = checkThemePackLimits(patch.themePack);
  if (!limits.ok) return limits;
  const result = validatePack(mergePack(preset, patch.themePack));
  if (!result.ok) return { ok: false, errors: result.errors, tooLarge: false };
  return { ok: true, themePack: sparsify(result.pack, preset) };
}

/** Config as anyone may see it: the pack itself is served by /theme, not here. */
export function publicConfig(config) {
  if (!config || typeof config !== 'object') return config;
  const { themePack, ...rest } = config;
  return rest;
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A short stable id for "what this board's displays should be drawing".
 * Changes when the preset or the overrides change and not otherwise; the
 * display's skin cache and /theme's ETag are keyed by it.
 */
export async function themeRevOf(config) {
  const { id, themePack } = resolveBoardTheme(config);
  const hash = await sha256Hex(stableStringify({ theme: id, themePack }));
  return hash.slice(0, 16);
}

/** What /capabilities tells an agent about custom themes. */
export function themeCapabilities(ranges) {
  return {
    presets: Object.values(THEMES).map(({ id, name, description }) => ({ id, name, description })),
    sections: [...SECTIONS],
    states: DEFAULT_CYCLE.map((state) => state.char),
    ranges,
    ...THEME_LIMITS,
  };
}
