import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_FAMILIES, TEMPLATES, getTemplate } from '../lib/board-types/templates.mjs';
import { BOARD_TYPES } from '../lib/board-types/index.mjs';
import { applyParams } from '../lib/board-types/contract.mjs';
import { validateConfigPatch, textOptions, LIMITS } from '../lib/api/validators.mjs';
import { validateSchedule } from '../lib/board/schedule.mjs';
import { charsetFromManifest } from '../lib/board/layout.mjs';
import { RING } from '../lib/board/ring.mjs';

/**
 * Templates are content, and content rots: a type renamed, a schedule kind
 * retired, a poster line that needs a glyph the tiles do not have. Every
 * template is checked against the same validators the API applies, so a
 * card on /new can never lead to a 422.
 */

const manifest = { cycle: RING };
const charset = new Set(charsetFromManifest(manifest));

test('every template names a registered type and a unique id', () => {
  const ids = new Set();
  for (const family of TEMPLATE_FAMILIES) {
    assert.ok(family.templates.length > 0, `${family.id} has no cards`);
    for (const template of family.templates) {
      assert.ok(!ids.has(template.id), `duplicate template id ${template.id}`);
      ids.add(template.id);
      assert.ok(BOARD_TYPES.has(template.type), `${template.id}: unknown type ${template.type}`);
      assert.equal(getTemplate(template.id), template);
    }
  }
  assert.equal(getTemplate('nope'), null);
});

test('the first rail names three intentions, not the type registry', () => {
  const [start] = TEMPLATE_FAMILIES;
  assert.equal(start.id, 'start');
  assert.deepEqual(start.templates.map((t) => t.id), ['sign', 'cycle', 'timetable']);
  for (const template of start.templates) assert.equal(template.starter, true);
  assert.ok(start.templates.some((t) => t.recommended), 'one starter is the recommended start');

  // A sign and a cycle are the same machine, so moving between them later is
  // free; only a timetable is the choice that cannot be undone. That is the
  // whole reason these are named for intentions rather than for types.
  const byId = new Map(start.templates.map((t) => [t.id, t]));
  assert.equal(byId.get('sign').type, 'live');
  assert.equal(byId.get('cycle').type, 'live');
  assert.equal(byId.get('timetable').type, 'scheduled');

  // A sign is one looping message and a cycle is several - the difference is
  // content, not machinery.
  assert.equal(byId.get('sign').seed.length, 1);
  assert.ok(byId.get('cycle').seed.length > 1);
  for (const id of ['sign', 'cycle']) {
    for (const seed of byId.get(id).seed) {
      assert.equal(seed.loop, true, `${id} seeds must loop or the board runs dry`);
    }
  }

  // `shared` is still a registered type so existing boards keep working, and is
  // no longer offered, because it was {...scheduled} with a different name.
  assert.ok(BOARD_TYPES.has('shared'), 'the type stays for boards that already use it');
  assert.ok(!start.templates.some((t) => t.type === 'shared'), 'and is not offered');
});

test('poster lines fit a card and use only glyphs the tiles have', () => {
  for (const template of TEMPLATES.values()) {
    assert.ok(template.poster.length >= 1 && template.poster.length <= 2, `${template.id}: 1-2 poster lines`);
    for (const line of template.poster) {
      assert.ok(line.length <= 12, `${template.id}: poster line "${line}" is over 12 tiles`);
      for (const char of line.toUpperCase()) {
        assert.ok(charset.has(char) || char === ' ', `${template.id}: poster glyph ${JSON.stringify(char)} is not on the tiles`);
      }
    }
  }
});

test('params, config and seeds pass the validators the API applies', () => {
  for (const template of TEMPLATES.values()) {
    const type = BOARD_TYPES.get(template.type);
    // Params, exactly as createBoard applies them (the body adds a name).
    const config = applyParams(type.createParams, { ...template.params, name: template.defaultName || 'x' });
    type.validateConfig?.({ ...config, ...template.config });
    validateConfigPatch(template.config);
    for (const seed of template.seed) {
      const { text } = textOptions(seed, LIMITS);
      assert.ok(typeof text === 'string', `${template.id}: seed has no text`);
      if (seed.schedule !== undefined) {
        assert.equal(type.playback, 'clock', `${template.id}: a schedule on a ${type.playback} board`);
        validateSchedule(seed.schedule);
      } else {
        assert.notEqual(type.playback, 'clock', `${template.id}: an unscheduled seed on a clock board plays once and vanishes`);
      }
      // Literal rows must fit the grid they are seeded into.
      if (seed.rows) {
        const cols = template.config.cols ?? 20;
        for (const row of seed.rows) assert.ok(row.length <= cols, `${template.id}: row "${row}" is wider than ${cols}`);
      }
    }
    assert.ok(template.what.length >= 1, `${template.id}: say what you get`);
    assert.ok(template.tagline, `${template.id}: needs a tagline`);
  }
});

test('a prefilled template name steps around the names the account already has', async () => {
  const { nextFreeName } = await import('../lib/board-types/names.mjs');
  assert.equal(nextFreeName('Carrow Road', []), 'Carrow Road');
  assert.equal(nextFreeName('Carrow Road', ['Lobby']), 'Carrow Road');
  assert.equal(nextFreeName('Carrow Road', ['Carrow Road']), 'Carrow Road 2');
  assert.equal(nextFreeName('Carrow Road', ['carrow road', 'Carrow Road 2']), 'Carrow Road 3', 'case-insensitive, and keeps counting');
  assert.equal(nextFreeName('', ['x']), '', 'a blank template name stays blank');
  assert.equal(nextFreeName('  Lobby ', ['Lobby']), 'Lobby 2', 'trimmed before comparing');
});
