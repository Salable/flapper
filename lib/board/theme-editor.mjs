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

/**
 * The embedded file(s) a built-in face needs to actually render, rather than
 * fall back to whatever comes next in its CSS stack. A face with no entry
 * here is a system stack - the viewer's OS already has it, nothing to load.
 * Self-hosted the same way Arimo always has been: root-relative, never a
 * remote host (a pack's fonts are validated on exactly that rule).
 */
const FONT_FILES = Object.freeze({
  arimo: [
    { family: 'Arimo', src: '/fonts/arimo/Arimo-400.woff2', weight: '400' },
    { family: 'Arimo', src: '/fonts/arimo/Arimo-500.woff2', weight: '500' },
    { family: 'Arimo', src: '/fonts/arimo/Arimo-700.woff2', weight: '700' },
  ],
  'work-sans': [
    { family: 'Work Sans', src: '/fonts/work-sans/WorkSans-Variable.woff2', weight: '400' },
    { family: 'Work Sans', src: '/fonts/work-sans/WorkSans-Variable.woff2', weight: '500' },
    { family: 'Work Sans', src: '/fonts/work-sans/WorkSans-Variable.woff2', weight: '700' },
  ],
  'source-serif': [
    { family: 'Source Serif 4', src: '/fonts/source-serif/SourceSerif4-Variable.woff2', weight: '400' },
    { family: 'Source Serif 4', src: '/fonts/source-serif/SourceSerif4-Variable.woff2', weight: '500' },
    { family: 'Source Serif 4', src: '/fonts/source-serif/SourceSerif4-Variable.woff2', weight: '700' },
  ],
  'ibm-plex-mono': [
    { family: 'IBM Plex Mono', src: '/fonts/ibm-plex-mono/IBMPlexMono-400.woff2', weight: '400' },
    { family: 'IBM Plex Mono', src: '/fonts/ibm-plex-mono/IBMPlexMono-500.woff2', weight: '500' },
    { family: 'IBM Plex Mono', src: '/fonts/ibm-plex-mono/IBMPlexMono-700.woff2', weight: '700' },
  ],
  oswald: [
    { family: 'Oswald', src: '/fonts/oswald/Oswald-Variable.woff2', weight: '400' },
    { family: 'Oswald', src: '/fonts/oswald/Oswald-Variable.woff2', weight: '500' },
    { family: 'Oswald', src: '/fonts/oswald/Oswald-Variable.woff2', weight: '700' },
  ],
  tourney: [
    { family: 'Tourney', src: '/fonts/tourney/Tourney-Variable.woff2', weight: '400' },
    { family: 'Tourney', src: '/fonts/tourney/Tourney-Variable.woff2', weight: '500' },
    { family: 'Tourney', src: '/fonts/tourney/Tourney-Variable.woff2', weight: '700' },
  ],
});

/** The faces the editor offers. */
export const FONT_CHOICES = Object.freeze([
  { id: 'arimo', label: 'Arimo (Helvetica)', stack: 'Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'work-sans', label: 'Work Sans', stack: '"Work Sans", "Helvetica Neue", Helvetica, Arial, sans-serif' },
  {
    id: 'source-serif',
    label: 'Source Serif 4 (serif)',
    stack: '"Source Serif 4", Georgia, "Times New Roman", serif',
  },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono (mono)', stack: '"IBM Plex Mono", "Courier New", Courier, monospace' },
  { id: 'oswald', label: 'Oswald (condensed)', stack: 'Oswald, "Arial Narrow", sans-serif' },
  { id: 'tourney', label: 'Tourney (stiff)', stack: 'Tourney, "Arial Narrow", sans-serif' },
  { id: 'georgia', label: 'Georgia (serif)', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'courier', label: 'Courier (mono)', stack: '"Courier New", Courier, monospace' },
  { id: 'system', label: 'System sans', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
]);

export const FONT_WEIGHTS = Object.freeze(['400', '500', '700', '800']);

const KNOWN_FONT_FILE_SRCS = new Set(Object.values(FONT_FILES).flatMap((files) => files.map((f) => f.src)));

/**
 * Change the glyph face, updating the pack's own `fonts` array to match in
 * the same draft - the file a chosen face needs, replacing whichever built-in
 * face's files were there, so picking one actually renders it rather than
 * falling back to the stack's next name. Anything in `fonts` that is not one
 * of the files above is left exactly alone: a custom font an agent posted
 * directly is never disturbed by a click in this dropdown.
 */
export function setGlyphFont(draft, change) {
  const next = { ...parseFont(draft.pack.glyph.font), ...change };
  const withoutOldBuiltIn = (draft.pack.fonts || []).filter((f) => !KNOWN_FONT_FILE_SRCS.has(f.src));
  const files = FONT_FILES[next.family] ?? [];
  const withFont = setDraftField(draft, 'glyph.font', buildFont(next));
  return { ...withFont, pack: { ...withFont.pack, fonts: [...withoutOldBuiltIn, ...files] } };
}

/**
 * A flight pattern (lib/board/tint.mjs `flightColour`) from an ordered list
 * of colours - a handful you pick, repeats and all: a colour appearing
 * three times in the list flashes three times as often as one that appears
 * once. Spread across the ring with the same deliberate unevenness Carnival
 * was hand-placed with (a colour every few steps, then a long run of plain
 * cards) rather than one slot per colour in strict rotation, which reads as
 * a machine rather than a mechanism.
 *
 * Each colour gets its own band of the ring (`RING.length / colours.length`
 * wide) and lands somewhere inside it, jittered by the golden ratio
 * conjugate rather than always at the band's start - a classic
 * low-discrepancy sequence, so the gaps between placed colours still look
 * irregular. Bands never overlap, so position always increases with list
 * index: `paletteOfFlight(buildFlight(list))` reads back as exactly `list`,
 * not just the same colours in some other order. That round trip has to
 * hold, because the editor rebuilds the pattern and reads the palette back
 * out of it on every single keystroke or drag - if the read-back order ever
 * drifted from the order it was written in, an edit to one swatch could
 * land on a different one next render, mid-drag, repeatedly.
 */
const GOLDEN_CONJUGATE = 0.6180339887498949;

export function buildFlight(colours) {
  if (!colours || colours.length === 0) return null;
  const list = colours.slice(0, RING.length);
  const slots = new Array(RING.length).fill(null);
  const n = list.length;
  list.forEach((colour, i) => {
    const bandStart = Math.floor((i * RING.length) / n);
    const bandEnd = Math.floor(((i + 1) * RING.length) / n);
    const span = Math.max(1, bandEnd - bandStart);
    const jitter = Math.floor(((i + 1) * GOLDEN_CONJUGATE * span) % span);
    slots[bandStart + jitter] = colour;
  });
  return slots;
}

/**
 * The colours a flight pattern reads back as, in the order `buildFlight`
 * placed them - the editor's own list, so opening a design that already has
 * one (Carnival) shows its colours as swatches you can edit, rather than a
 * blank palette that would silently drop whatever was there on the first
 * change.
 */
export function paletteOfFlight(flight) {
  return Array.isArray(flight) ? flight.filter((entry) => entry !== null) : [];
}

/** Replace a draft's flight pattern with the one this palette builds. */
export function setFlightPalette(draft, colours) {
  return { ...draft, pack: { ...draft.pack, flight: buildFlight(colours) } };
}

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
