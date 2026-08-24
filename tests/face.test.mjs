import test from 'node:test';
import assert from 'node:assert/strict';

import { faceColours, faceStyle } from '../lib/board/face.mjs';
import { THEMES } from '../lib/board/themes.mjs';

test('a pack becomes the face colours a CSS tile reads', () => {
  const face = faceColours(THEMES.classic);
  // The middle stop is the pack's own card colour, not an approximation of it.
  assert.equal(face.mid, THEMES.classic.card.fill);
  // The other two travel away from it, lighter above and darker below.
  assert.ok(face.hi > face.mid, `${face.hi} should be lighter than ${face.mid}`);
  assert.ok(face.lo < face.mid, `${face.lo} should be darker than ${face.mid}`);
  assert.equal(face.ink, THEMES.classic.glyph.fill);
});

test("an outline pack's ink is its stroke, because its fill is transparent", () => {
  // Canary draws white outlines on green. Reading glyph.fill would give
  // `transparent`, and a poster with invisible letters.
  assert.equal(THEMES.canary.glyph.fill, 'transparent');
  assert.equal(faceColours(THEMES.canary).ink, '#ffffff');
  assert.equal(faceColours(THEMES.canary).mid, THEMES.canary.card.fill);
});

test('every shipped design produces a usable face', () => {
  for (const [id, pack] of Object.entries(THEMES)) {
    const face = faceColours(pack);
    assert.ok(face, `${id} has no face`);
    for (const key of ['hi', 'mid', 'lo', 'ink', 'edge']) {
      assert.match(face[key], /^#[0-9a-f]{6}$/, `${id}.${key} is ${face[key]}`);
    }
  }
});

test('a light design stays light and a dark one stays dark', () => {
  const dark = faceColours(THEMES.classic);
  const light = faceColours(THEMES.sorbet);
  const brightness = (h) => parseInt(h.slice(1, 3), 16);
  assert.ok(brightness(light.mid) > 200, 'sorbet is a pale card');
  assert.ok(brightness(dark.mid) < 80, 'classic is a dark card');
  // And neither clips: lightening a near-white card must not overflow.
  assert.match(light.hi, /^#[0-9a-f]{6}$/);
});

test('shading decides how far the outer stops travel', () => {
  const flat = faceColours({ card: { fill: '#808080', edge: '#000' }, glyph: { fill: '#fff' }, motion: { shading: 0 } });
  const steep = faceColours({ card: { fill: '#808080', edge: '#000' }, glyph: { fill: '#fff' }, motion: { shading: 1 } });
  // With no shading the three stops collapse onto the base colour.
  assert.equal(flat.hi, flat.mid);
  assert.equal(flat.lo, flat.mid);
  assert.notEqual(steep.hi, steep.mid);
});

test('an unreadable pack leaves the defaults alone rather than making a colourless tile', () => {
  assert.equal(faceColours(null), null);
  assert.equal(faceColours({}), null);
  assert.equal(faceColours({ card: { fill: 'rebeccapurple' } }), null);
  assert.deepEqual(faceStyle(null), {});
});

test('faceStyle names the custom properties the tile rules already read', () => {
  const style = faceStyle(THEMES.canary);
  assert.deepEqual(Object.keys(style).sort(), [
    '--ink',
    '--tile-edge',
    '--tile-hi',
    '--tile-lo',
    '--tile-mid',
  ]);
  assert.equal(style['--ink'], '#ffffff');
});
