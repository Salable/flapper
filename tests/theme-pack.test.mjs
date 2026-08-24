import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack, resolveStateStyle, fontForSize, DEFAULT_CYCLE, PACK_DEFAULTS } from '../lib/board/theme-pack.mjs';
import { THEMES, THEME_IDS, DEFAULT_THEME, resolveTheme, isTheme } from '../lib/board/themes.mjs';
import { flightColour } from '../lib/board/tint.mjs';
import { RING, ringChars } from '../lib/board/ring.mjs';
import { paintCard, ProceduralSkin } from '../lib/board/skins/procedural.mjs';

test('the ring is the 42 states every board advertises, blank first, closed and unique', () => {
  assert.equal(ringChars().join(''), ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!()');
  assert.equal(new Set(ringChars()).size, RING.length);
  assert.equal(RING.filter((s) => s.name === 'blank').length, 1);
  assert.equal(RING[0].name, 'blank');
  assert.equal(DEFAULT_CYCLE, RING, 'a pack paints exactly the ring');
  assert.ok(Object.isFrozen(RING) && Object.isFrozen(RING[0]));
});

test('an empty pack is the Classic look', () => {
  const result = validatePack({ id: 'x' });
  assert.ok(result.ok, result.errors);
  assert.deepEqual(result.pack.card, PACK_DEFAULTS.card);
  assert.deepEqual(result.pack.glyph, PACK_DEFAULTS.glyph);
  assert.deepEqual(result.pack.states, {});
});

test('every problem is reported, not just the first', () => {
  const result = validatePack({
    id: 'bad id!',
    card: { fill: 'notacolour', radius: 2 },
    glyph: { font: 'Arial 12px' },
    ring: ' AB',
    states: { '#': {}, A: { art: 'missing' }, B: { glyph: { fill: 'nope' } } },
  });
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  for (const expected of ['id must', 'card.fill', 'card.radius', 'glyph.font', 'ring cannot', 'states["#"] is not in the ring', 'unknown art "missing"', 'states["B"].glyph.fill']) {
    assert.ok(text.includes(expected), `missing: ${expected}\n${text}`);
  }
});

test('non-object packs and sections are refused', () => {
  assert.equal(validatePack(null).ok, false);
  assert.equal(validatePack([]).ok, false);
  assert.match(validatePack({ card: [] }).errors.join(), /card must be an object/);
  assert.match(validatePack({ states: [] }).errors.join(), /states must be an object/);
});

test('per-state overrides merge one level deep over the pack', () => {
  const { pack } = validatePack({
    id: 'p',
    glyph: { fill: '#fff' },
    art: { logo: 'data:image/png;base64,AAAA' },
    states: { '!': { glyph: { fill: '#f00' } }, '(': { art: 'logo' } },
  });
  assert.equal(resolveStateStyle(pack, '!').glyph.fill, '#f00');
  assert.equal(resolveStateStyle(pack, '!').glyph.font, PACK_DEFAULTS.glyph.font, 'untouched fields keep the pack value');
  assert.equal(resolveStateStyle(pack, 'A').glyph.fill, '#fff');
  assert.equal(resolveStateStyle(pack, '(').art, 'logo');
  assert.equal(resolveStateStyle(pack, 'A').art, null);
});

test('art is shipped with the app or inlined - never fetched from elsewhere', () => {
  assert.equal(validatePack({ art: { a: 'javascript:alert(1)' } }).ok, false);
  assert.equal(validatePack({ art: { a: 'https://x/y.png' } }).ok, false, 'remote art would make every viewer fetch a third party');
  assert.equal(validatePack({ art: { a: 'data:image/svg+xml;base64,PHN2Zz4=' } }).ok, false, 'svg decode is unreliable');
  assert.equal(validatePack({ art: { a: 'data:image/png;base64,iVBORw0KGgo=' } }).ok, true);
  assert.equal(validatePack({ art: { a: 'data:image/webp;base64,UklGRg==' } }).ok, true);
  assert.equal(validatePack({ art: { a: '/brand/x.png' } }).ok, true);
  assert.equal(validatePack({ fonts: [{ family: 'X', src: 'https://x/f.woff2' }] }).ok, false);
  assert.equal(validatePack({ fonts: [{ family: 'X', src: '/fonts/x.woff2' }] }).ok, true);
});

test('fonts scale with the tile', () => {
  assert.equal(fontForSize('700 0.86em Helvetica', 100), '700 86px Helvetica');
  assert.equal(fontForSize('0.5em Georgia', 26), '13px Georgia');
});

test('the shipped themes are all valid packs', () => {
  assert.deepEqual([...THEME_IDS], ['classic', 'canary', 'sorbet', 'carnival', 'marquee']);
  for (const id of THEME_IDS) {
    assert.equal(THEMES[id].id, id);
    assert.ok(validatePack(THEMES[id]).ok);
    assert.ok(Object.isFrozen(THEMES[id]));
  }
  assert.equal(DEFAULT_THEME, 'classic');
});

test('the ids the drawn twins wore still resolve, but are not themes', () => {
  assert.equal(resolveTheme('classic-p').id, 'classic');
  assert.equal(resolveTheme('canary-p').id, 'canary');
  assert.equal(isTheme('canary-p'), false);
  assert.equal(resolveTheme('tartan').id, DEFAULT_THEME);
  assert.equal(resolveTheme(undefined).id, DEFAULT_THEME);
});

/** A 2D context that remembers what was asked of it. */
function stubContext(log) {
  const ctx = { canvas: {} };
  for (const method of [
    'clearRect', 'fillRect', 'fill', 'beginPath', 'roundRect', 'rect', 'drawImage',
    'fillText', 'strokeText', 'save', 'restore', 'translate', 'scale',
  ]) {
    ctx[method] = (...args) => log.push([method, ...args]);
  }
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  return ctx;
}

test('paintCard draws the card then the glyph, and nothing for blank', () => {
  const { pack } = validatePack({ id: 'p', glyph: { stroke: '#fff' } });
  let log = [];
  paintCard(stubContext(log), 100, 'A', resolveStateStyle(pack, 'A'));
  const calls = log.map((c) => c[0]);
  assert.deepEqual(calls.filter((c) => c === 'fill').length, 3, 'edge, face, sheen');
  assert.ok(calls.indexOf('strokeText') < calls.indexOf('fillText'), 'stroke under fill');
  assert.deepEqual(log.find((c) => c[0] === 'fillText').slice(1, 2), ['A']);

  log = [];
  paintCard(stubContext(log), 100, ' ', resolveStateStyle(pack, ' '));
  assert.ok(!log.some((c) => c[0] === 'fillText' || c[0] === 'strokeText'));
});

test('paintCard draws art instead of the glyph', () => {
  const { pack } = validatePack({ id: 'p', art: { logo: '/x.png' }, states: { '(': { art: 'logo' } } });
  const log = [];
  paintCard(stubContext(log), 100, '(', resolveStateStyle(pack, '('), { width: 50, height: 25 });
  const draw = log.find((c) => c[0] === 'drawImage');
  assert.ok(draw);
  assert.deepEqual(draw.slice(4), [72, 36], 'scaled to the 72% box, aspect kept');
  assert.ok(!log.some((c) => c[0] === 'fillText'));
});

function fakeSkinCanvas(log) {
  return (size) => ({ width: size, height: size, getContext: () => stubContext(log) });
}

test('ProceduralSkin builds one card per state, once per size', () => {
  const { pack } = validatePack({ id: 'p' });
  const log = [];
  const skin = new ProceduralSkin(pack, { createCanvas: fakeSkinCanvas(log) });
  assert.equal(skin.cycle.length, 42);
  skin.prepare(64);
  assert.equal(skin.cards.length, 42);
  const built = log.length;
  skin.prepare(64);
  assert.equal(log.length, built, 'same size: no rebuild');
  skin.prepare(32);
  assert.ok(log.length > built, 'new size: rebuilt');
});

test('ProceduralSkin at rest draws both halves of the current card; in flight, the next top and a flap', () => {
  const { pack } = validatePack({ id: 'p' });
  const skin = new ProceduralSkin(pack, { createCanvas: fakeSkinCanvas([]) });
  skin.prepare(100);
  let log = [];
  skin.drawTile(stubContext(log), 1, 0, 10, 20, 100);
  let draws = log.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 2);
  assert.equal(draws[0][1], skin.cards[1], 'top half is the current card at rest');
  assert.equal(draws[1][1], skin.cards[1]);

  log = [];
  skin.drawTile(stubContext(log), 1, 0.25, 10, 20, 100);
  draws = log.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 3);
  assert.equal(draws[0][1], skin.cards[2], 'top half shows the next card once the flap has left');
  assert.equal(draws[2][1], skin.cards[1], 'early in the flap the falling face is the current top');

  log = [];
  skin.drawTile(stubContext(log), 41, 0.75, 10, 20, 100);
  draws = log.filter((c) => c[0] === 'drawImage');
  assert.equal(draws[0][1], skin.cards[0], 'the ring wraps');
  assert.equal(draws[2][1], skin.cards[0], 'late in the flap the falling face is the next bottom');
});

test('Carnival colours the flight, not the letters', () => {
  const pack = THEMES.carnival;
  // Nothing per-state: a resting board is plain green, and the colour is
  // something you only catch while a tile is moving.
  assert.deepEqual(pack.states, {}, 'no letter carries a colour of its own');
  assert.ok(Array.isArray(pack.flight));
  // Uneven on purpose: an even pattern reads as a machine.
  const gaps = [];
  let since = 0;
  for (const entry of pack.flight) {
    if (entry === null) since += 1;
    else { gaps.push(since); since = 0; }
  }
  assert.ok(new Set(gaps).size > 1, `the gaps are all the same: ${gaps}`);
  assert.ok(pack.flight.length <= RING.length);
});

test('a flight colour repeats round the ring, and only where there is one', () => {
  const flight = [null, null, '#ff0000'];
  assert.equal(flightColour(flight, 0), null, 'a null step is the base card');
  assert.deepEqual(flightColour(flight, 2), { r: 255, g: 0, b: 0 });
  assert.deepEqual(flightColour(flight, 5), { r: 255, g: 0, b: 0 }, 'it repeats');
  assert.equal(flightColour(flight, 39), null, '39 % 3 is 0, a null step');
  assert.equal(flightColour(null, 3), null);
  assert.equal(flightColour([], 3), null);
});

test('a flight of nothing but nulls is refused as pointless', () => {
  const result = validatePack({ id: 'x', flight: [null, null] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /all nulls/);
});

test('art and fonts cannot reach a third-party host', () => {
  /*
   * The rule the comment beside the check has always claimed: a board must not
   * be able to make every viewer fetch a third party. A single leading slash
   * is this app's own files; two is protocol-relative, which resolves to
   * whatever host follows - so `//evil.example/x.png` passed a bare /^\// and
   * a public board would have fetched it from every wall and every visitor,
   * disclosing their IP and User-Agent. There is no CSP behind this to catch
   * it, so the validator is the only thing standing there.
   */
  for (const src of ['//evil.example/x.png', '//evil.example/f.woff2', '///evil.example/x.png']) {
    const art = validatePack({ art: { logo: src } });
    assert.equal(art.ok, false, `art ${src} was accepted`);
    assert.match(art.errors.join('; '), /art\.logo/);

    const fonts = validatePack({ fonts: [{ family: 'X', src }] });
    assert.equal(fonts.ok, false, `fonts ${src} was accepted`);
    assert.match(fonts.errors.join('; '), /fonts\[0\]\.src/);
  }

  // And the two forms that are the point of the rule still work.
  assert.equal(validatePack({ art: { logo: '/art/logo.png' } }).ok, true);
  assert.equal(validatePack({ fonts: [{ family: 'X', src: '/fonts/x.woff2' }] }).ok, true);
  assert.equal(
    validatePack({ art: { logo: 'data:image/png;base64,iVBORw0KGgo=' } }).ok,
    true,
  );
})

test('a null where a tint kind should be is a 422, not a crash', () => {
  /*
   * typeof null === 'object', so these got past the shape guard and
   * Object.keys(null) threw a TypeError out of validatePack. That meant a 500
   * from PATCH /config and POST /api/designs, it broke resolveBoardTheme's
   * "Never throws" contract, and in the theme editor it escaped during render
   * and lost the draft. Every other bad value here is a clean 422; these are
   * the ones that were not.
   */
  for (const tint of [{ corners: null }, { gradient: null }, { runner: null }]) {
    const result = validatePack({ tint });
    assert.equal(result.ok, false, `${JSON.stringify(tint)} was accepted`);
    assert.equal(result.errors.length > 0, true);
  }
})
