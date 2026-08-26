import test from 'node:test';
import assert from 'node:assert/strict';
import {
  presetDraft,
  draftFromConfig,
  setDraftField,
  setStateField,
  attachArt,
  detachArt,
  clearState,
  artKeyFor,
  parseFont,
  buildFont,
  draftToPatch,
  savedPatch,
  FONT_CHOICES,
  setGlyphFont,
  buildFlight,
  paletteOfFlight,
  setFlightPalette,
} from '../lib/board/theme-editor.mjs';
import { THEMES } from '../lib/board/themes.mjs';
import { validatePack } from '../lib/board/theme-pack.mjs';
import { RING } from '../lib/board/ring.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('a fresh draft is the preset and saves as no overrides', () => {
  const draft = presetDraft('canary');
  assert.equal(draft.theme, 'canary');
  assert.equal(draft.pack, THEMES.canary);
  assert.deepEqual(draftToPatch(draft), { ok: true, theme: 'canary', themePack: null });
  assert.equal(presetDraft('nope').theme, 'classic');
});

test('a draft from stored config is the board\'s resolved look', () => {
  const draft = draftFromConfig({ theme: 'classic', themePack: { card: { fill: '#fff' } } });
  assert.equal(draft.pack.card.fill, '#fff');
  assert.equal(draft.pack.card.edge, THEMES.classic.card.edge);
  assert.deepEqual(savedPatch({ theme: 'classic', themePack: { card: { fill: '#fff' } } }), { theme: 'classic', themePack: { card: { fill: '#fff' } } });
});

test('setting a field never mutates and round-trips to a sparse patch', () => {
  const before = presetDraft('classic');
  const after = setDraftField(before, 'card.fill', '#fff');
  assert.equal(before.pack.card.fill, THEMES.classic.card.fill);
  assert.equal(after.pack.card.fill, '#fff');
  assert.deepEqual(draftToPatch(after).themePack, { card: { fill: '#fff' } });
  // Setting it back makes the patch empty again.
  assert.equal(draftToPatch(setDraftField(after, 'card.fill', THEMES.classic.card.fill)).themePack, null);
});

test('glyph overrides: set, unset with null, and clear', () => {
  let draft = presetDraft('classic');
  draft = setStateField(draft, '!', 'glyph.fill', '#d9381e');
  draft = setStateField(draft, '!', 'card.fill', '#111111');
  assert.deepEqual(draft.pack.states['!'], { glyph: { fill: '#d9381e' }, card: { fill: '#111111' } });
  draft = setStateField(draft, '!', 'glyph.fill', null);
  assert.deepEqual(draft.pack.states['!'], { card: { fill: '#111111' } });
  draft = setStateField(draft, '!', 'card.fill', null);
  assert.equal('!' in draft.pack.states, false, 'an empty override disappears');
  draft = setStateField(draft, 'A', 'glyph.fill', '#0f0');
  assert.deepEqual(clearState(draft, 'A').pack.states, {});
});

test('art attaches by ring index and is pruned when nothing uses it', () => {
  assert.equal(artKeyFor('!'), 'art-39');
  assert.equal(artKeyFor('A'), 'art-1');
  assert.equal(artKeyFor('~'), null);
  let draft = presetDraft('classic');
  draft = attachArt(draft, '(', PNG);
  draft = attachArt(draft, ')', PNG);
  assert.deepEqual(Object.keys(draft.pack.art), ['art-40', 'art-41']);
  assert.equal(draft.pack.states['('].art, 'art-40');
  const patch = draftToPatch(draft);
  assert.ok(patch.ok, patch.errors);
  assert.deepEqual(Object.keys(patch.themePack.art), ['art-40', 'art-41']);
  draft = detachArt(draft, '(');
  assert.equal('(' in draft.pack.states, false);
  assert.deepEqual(Object.keys(draft.pack.art), ['art-41']);
  assert.equal(detachArt(draft, 'Z'), draft, 'nothing to detach, same draft');
});

test('fonts parse into the three controls and build back', () => {
  // By id, not position - the list grows as faces are added.
  const stackOf = (id) => FONT_CHOICES.find((c) => c.id === id).stack;
  assert.deepEqual(parseFont(THEMES.classic.glyph.font), { weight: '700', size: 0.94, family: 'oswald', stack: stackOf('oswald') });
  assert.deepEqual(parseFont('bold 0.9em Georgia, "Times New Roman", serif'), { weight: '700', size: 0.9, family: 'georgia', stack: stackOf('georgia') });
  assert.equal(parseFont('1em Comic Sans MS').family, null, 'unknown faces are custom');
  assert.equal(buildFont({ weight: '500', size: 0.8, family: 'courier' }), '500 0.8em "Courier New", Courier, monospace');
  assert.equal(buildFont({ weight: '500', size: 0.8, family: null, stack: 'Comic Sans MS' }), '500 0.8em Comic Sans MS');
  assert.equal(draftToPatch(setDraftField(presetDraft(), 'glyph.font', buildFont(parseFont(THEMES.classic.glyph.font)))).themePack, null);
});

test('an invalid draft reports the validator\'s words rather than a patch', () => {
  const bad = draftToPatch(setDraftField(presetDraft(), 'card.fill', 'not a colour'));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /card.fill/);
});

test('choosing a built-in face updates pack.fonts to match, in the same draft', () => {
  /*
   * The Face dropdown used to write only glyph.font - fine while Arimo was
   * the only face needing an actual file, since Georgia/Courier/System are
   * system stacks with nothing to load. Add a face that needs a real file
   * and picking it from the dropdown would set a font-family the pack never
   * registers, silently falling back to the stack's next name.
   */
  const draft = presetDraft('classic');
  assert.deepEqual(draft.pack.fonts.map((f) => f.family), ['Arimo', 'Arimo', 'Arimo']);

  const withWorkSans = setGlyphFont(draft, { family: 'work-sans' });
  assert.match(withWorkSans.pack.glyph.font, /"Work Sans"/);
  assert.deepEqual(withWorkSans.pack.fonts.map((f) => f.family), ['Work Sans', 'Work Sans', 'Work Sans']);
  assert.equal(validatePack(withWorkSans.pack).ok, true);

  // Swapping to a system stack needs no file at all - the old built-in's
  // entries are dropped and nothing replaces them.
  const toSystem = setGlyphFont(withWorkSans, { family: 'system' });
  assert.deepEqual(toSystem.pack.fonts, []);

  // And swapping back to Arimo restores its own three weights, not a stale
  // copy of whatever passed through in between.
  const backToArimo = setGlyphFont(toSystem, { family: 'arimo' });
  assert.deepEqual(backToArimo.pack.fonts.map((f) => f.weight), ['400', '500', '700']);

  // A custom font posted directly (not through this dropdown, e.g. an
  // agent's own upload) is never touched by picking a built-in face.
  const withCustom = { ...draft, pack: { ...draft.pack, fonts: [...draft.pack.fonts, { family: 'Custom', src: '/fonts/custom/Custom.woff2', weight: '400' }] } };
  const stillHasCustom = setGlyphFont(withCustom, { family: 'oswald' });
  assert.ok(stillHasCustom.pack.fonts.some((f) => f.family === 'Custom'));
})

test('buildFlight spreads a colour list across the ring, repeats and all', () => {
  assert.equal(buildFlight([]), null, 'nothing picked is no pattern at all');
  assert.equal(buildFlight(null), null);

  const one = buildFlight(['#ff0000']);
  assert.equal(one.length, RING.length);
  assert.deepEqual(one.filter((c) => c !== null), ['#ff0000']);

  // A colour appearing three times in the list flashes three times as
  // often - the count in the built pattern, not just its presence.
  const list = ['#ffffff', '#ffffff', '#ffffff', '#ff0000', '#ffffff'];
  const built = buildFlight(list);
  const placed = built.filter((c) => c !== null);
  assert.equal(placed.length, list.length, 'one ring slot per colour in the list');
  assert.equal(placed.filter((c) => c === '#ff0000').length, 1);
  assert.equal(placed.filter((c) => c === '#ffffff').length, 4);
  assert.equal(validatePack({ ...THEMES.classic, flight: built }).ok, true, 'always a pattern the schema accepts');

  // Deterministic: the same list builds the same pattern every time, not a
  // fresh shuffle - editing one swatch should not reshuffle every other one.
  assert.deepEqual(buildFlight(list), built);

  // More than one slot per ring position has nowhere left to go; capped
  // rather than looping forever hunting for a free one.
  const saturated = buildFlight(new Array(RING.length + 10).fill('#00ff00'));
  assert.equal(saturated.length, RING.length);
  assert.equal(saturated.filter((c) => c !== null).length, RING.length);
});

test('paletteOfFlight reads a pattern back as the list it flashes, in ring order', () => {
  assert.deepEqual(paletteOfFlight(null), []);
  assert.deepEqual(paletteOfFlight(undefined), []);
  assert.deepEqual(paletteOfFlight([null, '#a', null, '#b', '#a']), ['#a', '#b', '#a']);

  // Carnival's own hand-placed pattern, read back as a palette a person
  // could recognise: mostly amber, a little red, one white flash.
  assert.deepEqual(paletteOfFlight(THEMES.carnival.flight), ['#f2b134', '#f2b134', '#e2574c', '#f6f4ee', '#f2b134']);

  // Exact round trip, not just the same colours in some other order -
  // ThemeSettings rebuilds the pattern and reads the palette straight back
  // out of it on every edit (see buildFlight's own comment for why an
  // order drift here would corrupt whatever the editor is mid-drag on).
  const list = ['#111111', '#222222', '#333333'];
  assert.deepEqual(paletteOfFlight(buildFlight(list)), list);

  // Holds for every length up to a fully saturated ring, not just three.
  for (let n = 1; n <= RING.length; n += 1) {
    const shuffled = Array.from({ length: n }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`);
    assert.deepEqual(paletteOfFlight(buildFlight(shuffled)), shuffled, `n=${n}`);
  }
});

test('setFlightPalette replaces just the flight pattern', () => {
  const draft = presetDraft('carnival');
  const cleared = setFlightPalette(draft, []);
  assert.equal(cleared.pack.flight, null);
  assert.equal(cleared.pack.card.fill, draft.pack.card.fill, 'nothing else about the pack moves');

  const recoloured = setFlightPalette(draft, ['#0000ff']);
  assert.deepEqual(paletteOfFlight(recoloured.pack.flight), ['#0000ff']);
});
