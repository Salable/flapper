import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardDoc } from '../lib/api/agents-doc.mjs';
import { validateConfigPatch } from '../lib/api/validators.mjs';

/*
 * The docs are not allowed to promise something the server refuses.
 *
 * Both guides told agents to `PATCH /config` with `{"cols":20,"rows":8}` and
 * quoted "supported ranges are 1-80 columns and 1-40 rows" - for months after
 * the validator started answering that with a 422. Nothing caught it because
 * prose is not executable, and an agent reading a board's own guide is the
 * one reader who cannot tell it is being lied to: it does what the guide
 * says, gets a 422, and has no way to know the guide was wrong rather than
 * its own request.
 *
 * So the config examples are executed. Every `-d '{...}'` next to a
 * `PATCH .../config` in either document goes through the real validator, and
 * a document that recommends a refused field fails the build.
 *
 * This is a truth check, not a style one: it says nothing about whether the
 * prose is good, only that the commands in it work.
 */

/** Every JSON body in a `PATCH …/config` curl example, in document order. */
function configExamples(markdown) {
  const found = [];
  // A curl block runs to the closing fence; the body is the -d argument,
  // which may sit on its own continuation line.
  const blocks = markdown.split('```');
  for (const block of blocks) {
    if (!/curl\s+-X\s+PATCH/.test(block)) continue;
    if (!/\/config\b/.test(block)) continue;
    for (const match of block.matchAll(/-d\s+'([^']*)'/g)) {
      found.push(match[1]);
    }
  }
  return found;
}

const SOURCES = [
  ['docs/BOARD-API.md', readFileSync(new URL('../docs/BOARD-API.md', import.meta.url), 'utf8')],
  [
    "a board's own AGENTS.md",
    boardDoc({ base: 'https://example.test', slug: 'demo', version: '4.0.0' }),
  ],
];

for (const [name, text] of SOURCES) {
  test(`${name}: every /config example it gives is one the server accepts`, () => {
    const examples = configExamples(text);
    assert.ok(examples.length > 0, `no /config curl examples found in ${name} - has the shape changed?`);
    for (const body of examples) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        assert.fail(`${name} has a /config example that is not valid JSON: ${body}`);
      }
      try {
        validateConfigPatch(parsed);
      } catch (error) {
        assert.fail(
          `${name} tells a caller to send ${body}, and the server answers ` +
            `${error.status ?? '???'}: ${error.message}`,
        );
      }
    }
  });
}

test('the two guides agree about the fidgets that exist', () => {
  // The repo doc and the generated one are written separately and drifted
  // once already, in the other direction - the repo got a section the served
  // one never did.
  const [, repo] = SOURCES[0];
  const [, served] = SOURCES[1];
  for (const doc of [repo, served]) {
    assert.match(doc, /pina-colada/, 'a guide has no fidget list at all');
    assert.match(doc, /ambientMs/, 'a guide never mentions how a fidget is switched on');
  }
});
