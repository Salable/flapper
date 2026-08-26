import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_LIMITS,
  stableStringify,
  mergePack,
  sparsify,
  checkThemePackLimits,
  resolveBoardTheme,
  normalizeThemePatch,
  publicConfig,
  themeRevOf,
  themeCapabilities,
} from '../lib/board/board-theme.mjs';
import { THEMES } from '../lib/board/themes.mjs';
import { validatePack, RANGES } from '../lib/board/theme-pack.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WEBP = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

test('stableStringify is independent of key order', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }), stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('sections merge a level deep; states, art and fonts replace whole', () => {
  const classic = THEMES.classic;
  const merged = mergePack(classic, { card: { fill: '#fff' }, states: { A: { glyph: { fill: '#f00' } } } });
  assert.equal(merged.card.fill, '#fff');
  assert.equal(merged.card.edge, classic.card.edge, 'untouched card fields keep the preset value');
  assert.deepEqual(merged.states, { A: { glyph: { fill: '#f00' } } });
  assert.deepEqual(merged.fonts, classic.fonts, 'absent means the preset');
  assert.deepEqual(mergePack(classic, { fonts: [] }).fonts, [], 'present means replace, even with empty');
  assert.equal(merged.id, classic.id);
});

test('sparsify keeps only what differs, prunes unreferenced art, and is null when nothing does', () => {
  const classic = THEMES.classic;
  assert.equal(sparsify(classic, classic), null);
  const { pack } = validatePack(mergePack(classic, {
    card: { fill: '#fff', edge: classic.card.edge },
    art: { logo: PNG, orphan: WEBP },
    states: { '(': { art: 'logo' } },
  }));
  const sparse = sparsify(pack, classic);
  assert.deepEqual(sparse, { card: { fill: '#fff' }, states: { '(': { art: 'logo' } }, art: { logo: PNG } });
  // Idempotent: a whole pack and its own diff store the same thing.
  const again = validatePack(mergePack(classic, sparse)).pack;
  assert.deepEqual(sparsify(again, classic), sparse);
});

test('limits: shape, bytes, art count, art size and art magic', () => {
  assert.equal(checkThemePackLimits(null).ok, true);
  assert.equal(checkThemePackLimits(undefined).ok, true);
  assert.match(checkThemePackLimits([]).errors.join(), /object or null/);
  assert.match(checkThemePackLimits({ ring: 'AB' }).errors.join(), /ring is not a pack field/);

  const big = { card: { fill: '#' + 'f'.repeat(THEME_LIMITS.maxBytes) } };
  const bigResult = checkThemePackLimits(big);
  assert.equal(bigResult.ok, false);
  assert.equal(bigResult.tooLarge, true);

  const many = { art: Object.fromEntries(Array.from({ length: THEME_LIMITS.maxArts + 1 }, (_, i) => [`a${i}`, PNG])) };
  assert.equal(checkThemePackLimits(many).tooLarge, true);

  const fat = { art: { a: `data:image/png;base64,iVBORw0KGgo${'A'.repeat(Math.ceil((THEME_LIMITS.maxArtBytes * 4) / 3) + 8)}` } };
  assert.match(checkThemePackLimits(fat).errors.join(), /bytes decoded/);
  assert.equal(checkThemePackLimits(fat).tooLarge, true);

  const lying = { art: { a: 'data:image/png;base64,UklGRiIAAABXRUJQ' } };
  const lyingResult = checkThemePackLimits(lying);
  assert.match(lyingResult.errors.join(), /does not look like image\/png/);
  assert.equal(lyingResult.tooLarge, false, 'a wrong magic is a 422, not a 413');

  assert.equal(checkThemePackLimits({ art: { a: PNG, b: WEBP, c: '/brand/x.png' } }).ok, true);
});

test('resolveBoardTheme never throws: bad overrides fall back to the preset with warnings', () => {
  const fine = resolveBoardTheme({ theme: 'canary', themePack: { card: { fill: '#123456' } } });
  assert.equal(fine.id, 'canary');
  assert.equal(fine.pack.card.fill, '#123456');
  assert.equal(fine.pack.glyph.stroke, THEMES.canary.glyph.stroke, 'the rest is Canary');
  assert.deepEqual(fine.themePack, { card: { fill: '#123456' } });
  assert.deepEqual(fine.warnings, []);

  const bad = resolveBoardTheme({ theme: 'classic', themePack: { card: { fill: 'nope' } } });
  assert.equal(bad.pack, THEMES.classic);
  assert.equal(bad.themePack, null);
  assert.match(bad.warnings.join(), /card.fill/);

  assert.equal(resolveBoardTheme({}).pack, THEMES.classic);
  assert.equal(resolveBoardTheme({ theme: 'canary-p' }).id, 'canary', 'legacy ids still resolve');
  assert.equal(resolveBoardTheme({ theme: 'classic', themePack: null }).themePack, null);
});

test('normalizeThemePatch validates against the theme the patch or the board names', () => {
  // No themePack in the patch: nothing to say.
  assert.deepEqual(normalizeThemePatch({ theme: 'canary' }, {}), { ok: true });
  // null clears.
  assert.deepEqual(normalizeThemePatch({ themePack: null }, { theme: 'classic' }), { ok: true, themePack: null });
  // A pack equal to the current preset stores as null.
  assert.deepEqual(normalizeThemePatch({ themePack: { card: { fill: THEMES.classic.card.fill } } }, {}), { ok: true, themePack: null });
  // The same override against Canary is a real difference.
  const onCanary = normalizeThemePatch({ themePack: { card: { fill: THEMES.classic.card.fill } } }, { theme: 'canary' });
  assert.deepEqual(onCanary.themePack, { card: { fill: THEMES.classic.card.fill } });
  // Switching preset in the same patch validates against the new one.
  const both = normalizeThemePatch({ theme: 'canary', themePack: { card: { fill: THEMES.canary.card.fill } } }, { theme: 'classic' });
  assert.equal(both.themePack, null);
  // Invalid values come back as errors, sized ones flagged.
  assert.equal(normalizeThemePatch({ themePack: { glyph: { baseline: 9 } } }, {}).ok, false);
  assert.equal(normalizeThemePatch({ themePack: 'x' }, {}).ok, false);
});

test('publicConfig drops the pack and nothing else', () => {
  assert.deepEqual(publicConfig({ cols: 3, theme: 'canary', themePack: { card: {} } }), { cols: 3, theme: 'canary' });
  assert.deepEqual(publicConfig({ cols: 3 }), { cols: 3 });
  assert.equal(publicConfig(null), null);
});

test('a tint survives the round trip through a sparse override', () => {
  // The bug this catches: tint was added to the pack but not to the list of
  // things a board's override merges and stores, so a board's wash was
  // silently dropped between saving it and drawing it.
  const preset = THEMES.classic;
  const wash = { gradient: { from: '#f7d6e3', to: '#cfe3f8', angle: 35 }, mode: 'multiply', strength: 0.85 };
  const sparse = sparsify({ ...preset, tint: wash }, preset);
  assert.deepEqual(sparse.tint, wash, 'a tint unlike the preset is stored');
  assert.deepEqual(mergePack(preset, sparse).tint, wash, 'and comes back on merge');

  // A preset that has one keeps it when a board overrides something else.
  const merged = mergePack(THEMES.sorbet, { card: { fill: '#fff' } });
  assert.deepEqual(merged.tint, THEMES.sorbet.tint, "a preset's own tint is not lost");

  // And matching the preset stores nothing, as with every other field.
  assert.equal(sparsify({ ...THEMES.sorbet }, THEMES.sorbet), null);
});

test('a background survives the round trip through a sparse override', () => {
  // The same bug class the tint test above exists for, caught this time
  // before it shipped: background is a third top-level field alongside
  // tint and flight, threaded through the identical mergePack/sparsify/
  // PACK_KEYS machinery - nothing stops a future edit to that machinery
  // from forgetting it the way tint once was.
  const preset = THEMES.classic;
  const sparse = sparsify({ ...preset, background: '#1a2f4a' }, preset);
  assert.deepEqual(sparse.background, '#1a2f4a', 'a background unlike the preset is stored');
  assert.equal(mergePack(preset, sparse).background, '#1a2f4a', 'and comes back on merge');

  // A preset that has one keeps it when a board overrides something else.
  const merged = mergePack(THEMES.classic, { card: { fill: '#fff' } });
  assert.equal(merged.background, THEMES.classic.background, "a preset's own background is not lost");

  // And matching the preset stores nothing, as with every other field.
  assert.equal(sparsify({ ...THEMES.classic }, THEMES.classic), null);
});

test('themeRev is stable across key order and an equivalent whole pack, and moves with content', async () => {
  const a = await themeRevOf({ theme: 'classic', themePack: { card: { fill: '#fff', radius: 0.1 } } });
  const b = await themeRevOf({ themePack: { card: { radius: 0.1, fill: '#fff' } }, theme: 'classic' });
  const whole = await themeRevOf({ theme: 'classic', themePack: { ...THEMES.classic, card: { ...THEMES.classic.card, fill: '#fff', radius: 0.1 } } });
  const c = await themeRevOf({ theme: 'classic', themePack: { card: { fill: '#ffe' } } });
  const preset = await themeRevOf({ theme: 'classic' });
  const presetNull = await themeRevOf({ theme: 'classic', themePack: null });
  const legacy = await themeRevOf({ theme: 'classic-p' });
  assert.equal(a, b);
  assert.equal(a, whole, 'a whole pack and its diff are the same revision');
  assert.notEqual(a, c);
  assert.equal(preset, presetNull);
  assert.equal(preset, legacy);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('capabilities advertise presets, limits and ranges from one source', () => {
  const caps = themeCapabilities(RANGES);
  assert.deepEqual(caps.presets.map((p) => p.id), ['classic', 'canary', 'sorbet', 'carnival', 'carrow-road-yellow', 'carrow-road-green']);
  assert.equal(caps.maxBytes, THEME_LIMITS.maxBytes);
  assert.deepEqual(caps.artTypes, ['image/png', 'image/webp']);
  assert.equal(caps.ranges, RANGES);
  assert.equal(caps.states.length, 42);
});
