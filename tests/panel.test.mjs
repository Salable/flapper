import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './stub-board.mjs';
import {
  BLANK_LABEL,
  glassState,
  label,
  bandSummary,
  itemMeta,
  queueRows,
  queueSignature,
  bandViews,
  resolvePanelRegion,
  describeDiagnostics,
} from '../src/renderer/panel.mjs';

/**
 * These run against a real Controller wherever the state matters, so the
 * awkward cases - a drained band, a recycled message - are produced by the
 * control plane rather than described by a fixture that might be wrong.
 */

const band = (id, status) => status.regions[id];

/* ---- what a band is doing ---- */

test('a playing band is live, and says what is on it', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ALPHA');
  const main = band('main', controller.status());

  assert.equal(glassState(main), 'live');
  assert.equal(bandSummary(main), 'ALPHA');
});

test('a multi-page message shows how far through it is', (t) => {
  const { controller } = setup(t, 10, 1);
  controller.enqueue('NOW BOARDING GATE 14'); // 3 pages at 10 columns
  assert.equal(bandSummary(band('main', controller.status())), 'NOW BOARDING GATE 14 1/3');
});

test('a drained band is holding, not idle', (t) => {
  const { board, controller } = setup(t, 10, 2, 1);
  controller.enqueue('PLAYING', { region: 'footer' }); // one row, one page
  board.settle('footer');
  mock.timers.tick(1000); // its dwell expires; the queue drains

  const footer = band('footer', controller.status());
  assert.equal(footer.showing, null, 'nothing is playing');
  assert.equal(glassState(footer), 'held');
  assert.equal(
    bandSummary(footer),
    'holding PLAYING',
    'the readout must not call a standing strip idle',
  );
});

test('a band that has been cleared is blank', (t) => {
  const { board, controller } = setup(t, 10, 2, 1);
  controller.enqueue('PLAYING', { region: 'footer' });
  board.settle('footer');
  mock.timers.tick(1000);
  controller.clear('footer');

  const footer = band('footer', controller.status());
  assert.equal(glassState(footer), 'blank');
  assert.equal(bandSummary(footer), 'blank');
});

test('a band that has never shown anything is blank', (t) => {
  const { controller } = setup(t, 10, 2, 1);
  assert.equal(glassState(band('footer', controller.status())), 'blank');
  assert.equal(glassState(undefined), 'blank', 'and a missing band does not throw');
});

/* ---- labels ---- */

test('a message with no visible text is labelled rather than left empty', () => {
  assert.equal(label(''), BLANK_LABEL);
  assert.equal(label('   '), BLANK_LABEL);
  assert.equal(label(undefined), BLANK_LABEL);
});

test('a long message is shortened to fit one line', () => {
  assert.equal(label('SHORT'), 'SHORT');
  assert.equal(label('A'.repeat(28)), 'A'.repeat(28), 'exactly the limit is left alone');
  const long = label('A'.repeat(40));
  assert.equal(long.length, 28);
  assert.ok(long.endsWith('…'));
});

/* ---- queue rows ---- */

test('pending messages are listed in play order', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('CHARLIE');

  const rows = queueRows(band('main', controller.status()));
  assert.deepEqual(rows.map((row) => row.label), ['BRAVO', 'CHARLIE'], 'ALPHA is showing');
  assert.deepEqual(rows.map((row) => row.position), [1, 2]);
});

test('a badge appears only when it says something', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  const [bravo] = queueRows(band('main', controller.status()));
  assert.deepEqual(bravo.meta, ['API'], 'an ordinary message carries no clutter');

  assert.deepEqual(itemMeta({ repeat: true, pages: 1, source: 'ui' }), ['↻', 'UI']);
  assert.deepEqual(itemMeta({ priority: 'next', pages: 3, source: 'api' }), ['NEXT', '3P', 'API']);
  assert.deepEqual(itemMeta({ resumesOnPage: 2, pages: 4, source: 'api' }), ['4P', '→2', 'API']);
});

test('a pre-empted message keeps its identity in the list', (t) => {
  const { board, controller } = setup(t, 10, 1);
  controller.enqueue('NOW BOARDING GATE 14');
  board.settle();
  mock.timers.tick(1000); // on to page 2
  const displaced = controller.status().showing.id;

  controller.enqueue('URGENT', { priority: 'now' });
  const rows = queueRows(band('main', controller.status()));
  const resumed = rows.find((row) => row.id === displaced);
  assert.ok(resumed, 'the displaced message is in the queue, not lost');
  assert.ok(resumed.meta.includes('→2'), 'and says where it will pick up');
});

/* ---- the change detector ---- */

test('turning a page does not disturb the list', (t) => {
  const { board, controller } = setup(t, 10, 1);
  controller.enqueue('NOW BOARDING GATE 14');
  controller.enqueue('NEXT');

  const before = queueSignature(band('main', controller.status()));
  board.settle();
  mock.timers.tick(1000); // page 1 -> 2, same message

  assert.equal(controller.status().showing.page, 2, 'the board did move on');
  assert.equal(
    queueSignature(band('main', controller.status())),
    before,
    'but the queue is untouched, so the list must not be rebuilt',
  );
});

test('the list is rebuilt when the queue actually changes', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  const before = queueSignature(band('main', controller.status()));

  controller.enqueue('CHARLIE');
  const added = queueSignature(band('main', controller.status()));
  assert.notEqual(added, before, 'something arrived');

  board.settle();
  mock.timers.tick(1000);
  assert.notEqual(queueSignature(band('main', controller.status())), added, 'something left');
});

test('a message going round changes the list', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA', { repeat: true });
  controller.enqueue('BRAVO');
  const before = queueSignature(band('main', controller.status()));

  board.settle();
  mock.timers.tick(1000); // ALPHA finishes and rejoins the back of the queue

  const after = band('main', controller.status());
  assert.notEqual(queueSignature(after), before);
  assert.ok(
    queueRows(after).some((row) => row.repeat && row.meta.includes('↻')),
    'and it is marked as cycling',
  );
});

/* ---- band cards ---- */

test('bands are listed in the order they sit on the board', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  const views = bandViews(controller.status());
  assert.deepEqual(views.map((view) => view.id), ['main', 'footer']);
  assert.deepEqual(views.map((view) => view.name), ['MAIN', 'FOOTER']);
  assert.deepEqual(views.map((view) => view.height), [3, 1]);
});

test('a board with one band yields one card', (t) => {
  const { controller } = setup(t, 10, 4, 0);
  const views = bandViews(controller.status());
  assert.equal(views.length, 1);
  assert.equal(views[0].id, 'main');
  assert.equal(views[0].height, 4);
});

test('a card says whether its hold is its own or the board default', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  controller.configure({ regions: { footer: { dwellMs: 8000 } } });

  const [main, footer] = bandViews(controller.status());
  assert.equal(main.dwellInherited, true);
  assert.equal(footer.dwellInherited, false);
  assert.equal(footer.dwellMs, 8000);
});

test('a card carries the counts the header needs', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('CHARLIE');

  const [main] = bandViews(controller.status());
  assert.equal(main.queued, 2);
  assert.equal(main.summary, 'ALPHA');
  assert.equal(main.state, 'live');
  assert.equal(main.items.length, 2);
});

/* ---- the composer's target ---- */

test('the composer follows a band that has been configured away', () => {
  assert.equal(resolvePanelRegion('footer', ['main', 'footer']), 'footer');
  assert.equal(resolvePanelRegion('footer', ['main']), 'main', 'the footer is gone');
  assert.equal(resolvePanelRegion(undefined, ['main']), 'main');
  assert.equal(resolvePanelRegion('footer', []), 'main', 'and never returns nothing');
});

/* ---- diagnostics ---- */

test('diagnostics are summarised in one line', () => {
  assert.equal(describeDiagnostics(undefined), '');
  assert.equal(
    describeDiagnostics({
      pageCount: 1,
      unsupported: [],
      substitutions: [],
      brokenWords: [],
      clippedLines: [],
    }),
    '',
    'nothing worth saying stays quiet',
  );
  assert.equal(
    describeDiagnostics({
      pageCount: 3,
      unsupported: [{ char: '%' }, { char: '#' }],
      substitutions: [{ from: '?', to: '.' }, { from: "'", to: '' }],
      brokenWords: ['INCOMPREHENSIBILIT'],
      clippedLines: ['A', 'B'],
      truncated: true,
    }),
    // Substitutions are one group, so they sit together rather than each
    // claiming a separator of its own.
    "3 pages · dropped % # · ?→. '→· · split INCOMPREHENSIBILIT · clipped 2 · truncated",
  );
});

test('a real layout produces a real description', (t) => {
  const { controller } = setup(t, 20, 2);
  const result = controller.preview('R&D at 85% capacity');
  assert.match(describeDiagnostics(result.diagnostics), /dropped %/);
  assert.match(describeDiagnostics(result.diagnostics), /&→ AND /);
});
