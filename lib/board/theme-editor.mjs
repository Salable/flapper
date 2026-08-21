/**
 * The decisions behind the theme editor, kept out of the component so they
 * can be tested without a browser: what a draft is, how a field or a glyph
 * override is set, how an upload attaches to a character, and how a draft
 * becomes the patch the API stores.
 *
 * A draft is `{ theme, pack }` - the preset id and the *full* resolved pack
 * being edited. Every operation returns a new draft; nothing mutates.
 */

import { validatePack } from './theme-pack.mjs';
import { resolveTheme, DEFAULT_THEME } from './themes.mjs';
import { resolveBoardTheme, sparsify } from './board-theme.mjs';
import { RING } from './ring.mjs';

/** The faces the editor offers. Arimo ships with the app; the rest are system stacks that degrade gracefully. */
export const FONT_CHOICES = Object.freeze([
  { id: 'arimo', label: 'Arimo (Helvetica)', stack: 'Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia (serif)', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'courier', label: 'Courier (mono)', stack: '"Courier New", Courier, monospace' },
  { id: 'system', label: 'System sans', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
]);

export const FONT_WEIGHTS = Object.freeze(['400', '500', '700', '800']);

/** A draft that is exactly a preset. */
export function presetDraft(themeId = DEFAULT_THEME) {
  const preset = resolveTheme(themeId);
  return { theme: preset.id, pack: preset };
}

/** The draft a board's stored config describes. */
export function draftFromConfig(config) {
  const { id, pack } = resolveBoardTheme(config);
  return { theme: id, pack };
}

/** Immutable deep set on a pack: `setField(pack, 'card.fill', '#fff')`. */
function setField(pack, path, value) {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...pack, [head]: value };
  return { ...pack, [head]: setField(pack[head] || {}, rest.join('.'), value) };
}

export function setDraftField(draft, path, value) {
  return { ...draft, pack: setField(draft.pack, path, value) };
}

/** Art keys must be url-safe and a glyph like `!` is not; key by ring index. */
export function artKeyFor(char) {
  const index = RING.findIndex((state) => state.char === char);
  return index < 0 ? null : `art-${index}`;
}

function withoutKey(object, key) {
  const { [key]: _dropped, ...rest } = object || {};
  return rest;
}

/** Set one override on a character's state: `setStateField(draft, '!', 'glyph.fill', '#f00')`. */
export function setStateField(draft, char, path, value) {
  const states = { ...(draft.pack.states || {}) };
  const current = states[char] || {};
  states[char] = value === null || value === undefined ? dropPath(current, path) : setField(current, path, value);
  if (Object.keys(states[char]).length === 0) delete states[char];
  return { ...draft, pack: { ...draft.pack, states } };
}

function dropPath(object, path) {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return withoutKey(object, head);
  const inner = dropPath(object[head] || {}, rest.join('.'));
  return Object.keys(inner).length === 0 ? withoutKey(object, head) : { ...object, [head]: inner };
}

/** Give a character an image instead of its glyph. */
export function attachArt(draft, char, dataUri) {
  const key = artKeyFor(char);
  if (!key) return draft;
  const art = { ...(draft.pack.art || {}), [key]: dataUri };
  const states = { ...(draft.pack.states || {}), [char]: { ...(draft.pack.states?.[char] || {}), art: key } };
  return { ...draft, pack: { ...draft.pack, art, states } };
}

/** Take a character's image away; the image itself goes if nothing else uses it. */
export function detachArt(draft, char) {
  const states = { ...(draft.pack.states || {}) };
  const key = states[char]?.art;
  if (!key) return draft;
  states[char] = withoutKey(states[char], 'art');
  if (Object.keys(states[char]).length === 0) delete states[char];
  const stillUsed = Object.values(states).some((state) => state.art === key);
  const art = stillUsed ? draft.pack.art : withoutKey(draft.pack.art, key);
  return { ...draft, pack: { ...draft.pack, states, art } };
}

/** Forget every override on a character. */
export function clearState(draft, char) {
  const detached = detachArt(draft, char);
  return { ...detached, pack: { ...detached.pack, states: withoutKey(detached.pack.states, char) } };
}

/**
 * A CSS font shorthand as the editor's three controls see it. Unknown
 * families come back as `family: null` so the editor can show "custom" and
 * leave the string alone.
 */
export function parseFont(font) {
  const match = /^(?:(\d{3}|bold|normal)\s+)?(\d*\.?\d+)em\s+(.+)$/.exec(String(font).trim());
  if (!match) return { weight: '700', size: 0.86, family: null, stack: String(font) };
  const [, weight = '400', size, stack] = match;
  const choice = FONT_CHOICES.find((c) => c.stack === stack.trim());
  return { weight: weight === 'bold' ? '700' : weight === 'normal' ? '400' : weight, size: Number(size), family: choice?.id ?? null, stack: stack.trim() };
}

export function buildFont({ weight, size, family, stack }) {
  const choice = FONT_CHOICES.find((c) => c.id === family);
  return `${weight} ${size}em ${choice ? choice.stack : stack}`;
}

/**
 * The patch a draft saves as: `{ theme, themePack }` with the pack reduced
 * to what differs from the preset - or `{ ok: false, errors }` if the draft
 * does not validate, with the same words the API would use.
 */
export function draftToPatch(draft) {
  const preset = resolveTheme(draft.theme);
  const result = validatePack({ ...draft.pack, id: preset.id, name: preset.name, description: preset.description });
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, theme: preset.id, themePack: sparsify(result.pack, preset) };
}

/** What the board has saved, in the same shape, for a dirty check. */
export function savedPatch(config) {
  const { id, themePack } = resolveBoardTheme(config);
  return { theme: id, themePack };
}
