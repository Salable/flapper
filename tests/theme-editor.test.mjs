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
} from '../lib/board/theme-editor.mjs';
import { THEMES } from '../lib/board/themes.mjs';
import { validatePack } from '../lib/board/theme-pack.mjs';

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
  assert.deepEqual(parseFont(THEMES.classic.glyph.font), { weight: '700', size: 0.86, family: 'arimo', stack: stackOf('arimo') });
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
