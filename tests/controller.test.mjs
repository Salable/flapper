import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../lib/board/controller.mjs';
import { stubBoard, setup } from './stub-board.mjs';

test('messages play strictly in order', (t) => {
  const { board, controller } = setup(t);
  for (const word of ['ALPHA', 'BRAVO', 'CHARLIE']) controller.enqueue(word);

  assert.equal(controller.status().showing.text, 'ALPHA');
  assert.equal(controller.status().queue.length, 2);

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'BRAVO');

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'CHARLIE');

  board.settle();
  mock.timers.tick(1000);
  // Drained: the last message stands on the glass, and `showing` still says so.
  const drained = controller.status();
  assert.equal(drained.phase, 'holding');
  assert.equal(drained.showing.text, 'CHARLIE');
  assert.equal(drained.showing.held, true);
  assert.equal(drained.regions.main.phase, 'holding');
  assert.equal(drained.queue.length, 0);
});

test('a multi-page message shows every page before the next message', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('NOW BOARDING GATE 14'); // 3 pages on a 1x10 board
  controller.enqueue('NEXT');

  assert.equal(controller.status().showing.pages, 3);
  for (const page of [1, 2, 3]) {
    assert.equal(controller.status().showing.page, page);
    assert.equal(controller.status().showing.text, 'NOW BOARDING GATE 14');
    board.settle();
    mock.timers.tick(1000);
  }
  assert.equal(controller.status().showing.text, 'NEXT');
  assert.deepEqual(board.shown.slice(0, 3), ['NOW', 'BOARDING', 'GATE 14']);
});

test('a page needing no movement still advances', (t) => {
  const { board, controller } = setup(t);
  // The stub reports not-animating right after an immediate page; simulate a
  // page that lands with nothing to do by never calling settle().
  board.setRegionPage = function (id, lines) {
    this.lines.set(id, lines);
    this.shown.push(lines.join('|').trim());
    this.animating.delete(id); // nothing moved, so nothing will report settling
    return true;
  };
  controller.enqueue('A');
  controller.enqueue('B');
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'B', 'should not stall without an idle report');
});

test('reconfiguring the grid mid-message does not wedge playback', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('HELLO');
  controller.enqueue('WORLD');
  assert.equal(controller.status().showing.text, 'HELLO');

  // Board is mid-flip. A grid change re-lays out and snaps the page, which
  // means onIdle will never fire for it.
  controller.configure({ cols: 20, rows: 2 });
  assert.equal(board.isAnimating(), false, 'grid change snaps the page');

  mock.timers.tick(1000);
  assert.equal(
    controller.status().showing.text,
    'WORLD',
    'playback must continue after a reconfigure, not wait for the settle guard',
  );
});

test('a pre-empted message survives a reconfigure that shortens it', (t) => {
  const { board, controller } = setup(t, 10, 1);
  controller.enqueue('NOW BOARDING GATE 14'); // 3 pages at 10 columns

  board.settle();
  mock.timers.tick(1000); // advance to page 2
  assert.equal(controller.status().showing.page, 2);

  // Pre-emption parks the displaced message in the queue with pageIndex 1.
  controller.enqueue('URGENT', { priority: 'now' });
  assert.equal(controller.status().queue.items[0].resumesOnPage, 2);

  // A wider grid collapses it to a single page, leaving pageIndex out of range.
  controller.configure({ cols: 40 });

  board.settle();
  mock.timers.tick(1000);
  const showing = controller.status().showing;
  assert.equal(showing.text, 'NOW BOARDING GATE 14');
  assert.equal(showing.page, 1, 'page cursor must be clamped to the re-laid page count');
});

test('reconfiguring preserves a message\'s own alignment', (t) => {
  const { controller } = setup(t, 20, 2);
  controller.enqueue('HI');
  const queued = controller.enqueue('BYE', { align: 'right' });

  controller.configure({ cols: 10 });

  const item = controller.queue.find((entry) => entry.id === queued.id);
  assert.equal(item.pages[0][0], '       BYE', 'align:right must survive re-layout');
});

test('reconfiguring re-lays out a literal-rows message from its own rows', (t) => {
  const { controller } = setup(t, 10, 2);
  controller.enqueue('', { rows: ['ABC', 'DEF'] });
  controller.configure({ cols: 6 });

  assert.deepEqual(
    controller.current.pages[0],
    ['ABC   ', 'DEF   '],
    'literal rows must be re-placed, not re-flowed from the synthetic text',
  );
});

test('reconfiguring re-lays out queued messages for the new grid', (t) => {
  const { controller } = setup(t, 10, 1);
  controller.enqueue('SHORT');
  const queued = controller.enqueue('NOW BOARDING GATE 14');
  assert.equal(queued.pages, 3, '3 pages at 10 columns');

  controller.configure({ cols: 40, rows: 4 });
  const item = controller.status().queue.items.find((entry) => entry.id === queued.id);
  assert.equal(item.pages, 1, 'should fit one page at 40 columns');
});

test('flush drops pending but leaves the current message playing', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ONE');
  controller.enqueue('TWO');
  controller.enqueue('THREE');
  assert.equal(controller.flush(), 2);
  assert.equal(controller.status().showing.text, 'ONE');
  assert.equal(controller.status().queue.length, 0);
});

test('clear stops everything including the current message', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ONE');
  controller.enqueue('TWO');
  assert.equal(controller.clear(), 2);
  assert.equal(controller.status().showing, null);
  assert.equal(controller.status().phase, 'blank');
  assert.equal(controller.status().queue.length, 0);
});

test('the queue refuses to grow without bound', (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const controller = new Controller(stubBoard(), { maxQueue: 3 });

  // The cap is on *pending* messages. The first enqueue becomes the current
  // message immediately, so it takes four to fill a queue of three.
  for (let i = 0; i < 4; i += 1) controller.enqueue(`M${i}`);
  assert.equal(controller.status().queue.length, 3);

  assert.throws(() => controller.enqueue('OVERFLOW'), /queue is full/);
  try {
    controller.enqueue('OVERFLOW');
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.status, 429, 'should map to HTTP 429');
  }
});

test('preview reports without touching the board', (t) => {
  const { board, controller } = setup(t);
  const result = controller.preview('NOW BOARDING GATE 14');
  assert.equal(result.diagnostics.pageCount, 3);
  assert.ok(result.estimatedMs > 0);
  assert.equal(board.shown.length, 0, 'nothing should have been displayed');
  assert.equal(controller.status().showing, null);
});

test('enqueue reports queue position', (t) => {
  const { controller } = setup(t);
  assert.equal(controller.enqueue('A').position, 0, 'first plays immediately');
  assert.equal(controller.enqueue('B').position, 1);
  assert.equal(controller.enqueue('C').position, 2);
});

test('capabilities describe the real charset and accepted values', (t) => {
  const { controller } = setup(t);
  const caps = controller.capabilities();
  assert.equal(caps.charset, ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!()');
  assert.equal(caps.states, 42);
  assert.deepEqual(caps.wrap, ['word', 'char', 'none']);
  assert.deepEqual(caps.priority, ['normal', 'next', 'now']);
});

test('priority next jumps the queue without disturbing what is playing', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ONE');
  controller.enqueue('TWO');
  controller.enqueue('THREE');

  const jumped = controller.enqueue('URGENT', { priority: 'next' });
  assert.equal(jumped.position, 1, 'should be first in line, behind the current message');
  assert.equal(controller.status().showing.text, 'ONE', 'must not interrupt');

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'URGENT');

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'TWO', 'the rest of the queue is intact');
});

test('priority now pre-empts, then resumes what it displaced', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ONE');
  controller.enqueue('TWO');

  const jumped = controller.enqueue('URGENT', { priority: 'now' });
  assert.equal(jumped.position, 0, 'should be showing straight away');
  assert.equal(jumped.interrupted.id, 'm1');
  assert.equal(jumped.interrupted.resumesOnPage, 1);
  assert.equal(controller.status().showing.text, 'URGENT', 'displays immediately');
  assert.equal(controller.status().queue.items[0].text, 'ONE', 'displaced message is next');

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'ONE', 'resumes what it interrupted');

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'TWO', 'then carries on down the queue');
});

test('a pre-empted multi-page message resumes on the page it was showing', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('NOW BOARDING GATE 14'); // 3 pages on a 1x10 board

  board.settle();
  mock.timers.tick(1000); // advance to page 2
  assert.equal(controller.status().showing.page, 2);

  const jumped = controller.enqueue('URGENT', { priority: 'now' });
  assert.equal(jumped.interrupted.resumesOnPage, 2);
  assert.equal(controller.status().queue.items[0].resumesOnPage, 2);

  board.settle();
  mock.timers.tick(1000);
  const showing = controller.status().showing;
  assert.equal(showing.text, 'NOW BOARDING GATE 14');
  assert.equal(showing.page, 2, 'picks up where it left off rather than restarting');
});

test('priority now on an idle board just plays', (t) => {
  const { controller } = setup(t);
  const jumped = controller.enqueue('URGENT', { priority: 'now' });
  assert.equal(jumped.position, 0);
  assert.equal(jumped.interrupted, undefined, 'nothing to interrupt');
  assert.equal(controller.status().showing.text, 'URGENT');
});

test('an unknown priority is refused', (t) => {
  const { controller } = setup(t);
  try {
    controller.enqueue('NOPE', { priority: 'urgent' });
    assert.fail('should have thrown');
  } catch (error) {
    assert.match(error.message, /priority must be one of/);
    assert.equal(error.status, 422);
  }
});

test('ordinary messages still queue strictly in order', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ONE');
  assert.equal(controller.enqueue('TWO').position, 1);
  assert.equal(controller.enqueue('THREE', { priority: 'normal' }).position, 2);
  assert.deepEqual(
    controller.status().queue.items.map((entry) => entry.text),
    ['TWO', 'THREE'],
  );
});

/* ---- bands ---- */

test('a footer settling does not restart the main queue\'s hold', (t) => {
  const { board, controller } = setup(t, 10, 4, 1);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('NOW PLAYING', { region: 'footer' });

  board.settle('main');
  mock.timers.tick(600); // most of the way through ALPHA's hold

  // The footer lands mid-hold. On a board with one idle callback this would
  // restart the dwell and ALPHA would still be showing after the full second.
  board.settle('footer');
  mock.timers.tick(400);

  assert.equal(controller.status().showing.text, 'BRAVO', 'the main hold must not be reset');
});

test('the main queue advances while the footer is still moving', (t) => {
  const { board, controller } = setup(t, 10, 4, 1);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('NOW PLAYING', { region: 'footer' });
  assert.equal(board.isAnimating('footer'), true, 'the footer never settles in this test');

  board.settle('main');
  mock.timers.tick(1000);

  assert.equal(controller.status().showing.text, 'BRAVO');
  assert.equal(board.isAnimating('footer'), true, 'and it is still going');
});

test('the two bands play independently', (t) => {
  const { board, controller } = setup(t, 10, 4, 1);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('PLAYING', { region: 'footer' });

  const status = controller.status();
  assert.equal(status.regions.main.showing.text, 'ALPHA');
  assert.equal(status.regions.footer.showing.text, 'PLAYING');
  assert.equal(status.regions.main.queue.length, 1, 'BRAVO waits in the main queue only');
  assert.equal(status.regions.footer.queue.length, 0);

  // Draining the main queue leaves the footer alone.
  for (const _ of [1, 2]) {
    board.settle('main');
    mock.timers.tick(1000);
  }
  assert.equal(controller.status().regions.main.phase, 'holding');
  assert.equal(controller.status().regions.main.showing.held, true);
  assert.equal(controller.status().regions.footer.showing.text, 'PLAYING');
});

test('a message is laid out for its own band, not the whole board', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  assert.equal(controller.preview('SOME WORDS HERE').diagnostics.rows, 3, 'main gets 3 of 4 rows');
  assert.equal(
    controller.preview('SOME WORDS HERE', { region: 'footer' }).diagnostics.rows,
    1,
    'the footer gets its one row',
  );
});

test('the composed board puts the footer underneath the queue', (t) => {
  const { controller } = setup(t, 5, 3, 1);
  controller.enqueue('HI', { region: 'footer' });
  controller.enqueue('AB');

  assert.deepEqual(controller.status().lines, ['AB   ', '     ', 'HI   ']);
});

test('clearing one band leaves the other lit', (t) => {
  const { controller } = setup(t, 5, 3, 1);
  controller.enqueue('HI', { region: 'footer' });
  controller.enqueue('AB');

  assert.equal(controller.clear('main'), 1);
  assert.equal(controller.status().regions.footer.showing.text, 'HI');
  assert.deepEqual(controller.status().lines, ['     ', '     ', 'HI   ']);
});

test('clearing with no band named clears every band', (t) => {
  const { controller } = setup(t, 5, 3, 1);
  controller.enqueue('HI', { region: 'footer' });
  controller.enqueue('AB');
  controller.enqueue('CD');

  assert.equal(controller.clear(), 3, 'two main messages and one footer');
  assert.equal(controller.status().regions.main.showing, null);
  assert.equal(controller.status().regions.footer.showing, null);
});

test('changing the footer height re-lays both bands without wedging', (t) => {
  const { board, controller } = setup(t, 10, 4, 1);
  controller.enqueue('NOW BOARDING GATE 14');
  const queued = controller.enqueue('SOME MORE WORDS HERE');
  assert.equal(controller.status().showing.page, 1);

  controller.configure({ footerRows: 2 });

  assert.equal(controller.status().grid.mainRows, 2);
  assert.equal(controller.status().regions.main.rows, 2);
  const item = controller.queue.find((entry) => entry.id === queued.id);
  assert.equal(item.diagnostics.rows, 2, 'queued messages re-lay for the smaller band');

  mock.timers.tick(1000);
  assert.equal(
    controller.status().showing.text,
    'NOW BOARDING GATE 14',
    'playback must continue after a band change, not wait for the settle guard',
  );
});

test('removing the footer hands its rows back and drops its track', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  controller.enqueue('HI', { region: 'footer' });
  assert.equal(controller.status().regions.footer.rows, 1);

  controller.configure({ footerRows: 0 });

  assert.equal(controller.status().grid.mainRows, 4);
  assert.equal(controller.status().regions.footer, undefined, 'the band no longer exists');
  assert.deepEqual(controller.capabilities().regions, ['main']);
});

test('a footer taller than the board is clamped to leave a queue row', (t) => {
  const { controller } = setup(t, 10, 4, 0);
  controller.configure({ footerRows: 9 });

  assert.equal(controller.status().grid.footerRows, 3, 'reports the effective height');
  assert.equal(controller.status().grid.mainRows, 1);
});

test('an unknown band is refused rather than silently ignored', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  try {
    controller.enqueue('HI', { region: 'ticker' });
    assert.fail('should have thrown');
  } catch (error) {
    assert.match(error.message, /unknown region: ticker/);
    assert.equal(error.status, 422);
  }
});

test('capabilities describe the bands the board actually has', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  const caps = controller.capabilities();
  assert.deepEqual(caps.regions, ['main', 'footer']);
  assert.equal(caps.grid.mainRows, 3);
  assert.equal(caps.grid.footerRows, 1);
  assert.equal(caps.maxFooterRows, 3);
});

test('message ids stay unique across bands', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  const a = controller.enqueue('ONE');
  const b = controller.enqueue('TWO', { region: 'footer' });
  const c = controller.enqueue('THREE');
  assert.deepEqual([a.id, b.id, c.id], ['m1', 'm2', 'm3']);
});

test('priority pre-emption applies to a band on its own', (t) => {
  const { board, controller } = setup(t, 10, 4, 1);
  controller.enqueue('ALPHA');
  controller.enqueue('PLAYING', { region: 'footer' });

  const jumped = controller.enqueue('URGENT', { region: 'footer', priority: 'now' });
  assert.equal(jumped.interrupted.id, 'm2', 'it pre-empted the footer, not the main band');
  assert.equal(controller.status().regions.footer.showing.text, 'URGENT');
  assert.equal(controller.status().regions.main.showing.text, 'ALPHA', 'main is untouched');

  board.settle('footer');
  mock.timers.tick(1000);
  assert.equal(controller.status().regions.footer.showing.text, 'PLAYING', 'and it resumes');
});

/* ---- holding, and dwell resolving live ---- */

test('a drained band reports what it is still holding on the glass', (t) => {
  const { board, controller } = setup(t, 10, 2, 1);
  controller.enqueue('HI', { region: 'footer' });

  board.settle('footer');
  mock.timers.tick(1000); // its dwell expires and the queue drains

  const footer = controller.status().regions.footer;
  assert.equal(footer.phase, 'holding', 'nothing is playing');
  assert.equal(footer.showing.text, 'HI', 'but the last page is still on the glass');
  assert.equal(footer.showing.held, true);
  assert.deepEqual(controller.status().lines[1], 'HI        ');
});

test('clearing a band stops it holding', (t) => {
  const { board, controller } = setup(t, 10, 2, 1);
  controller.enqueue('HI', { region: 'footer' });
  board.settle('footer');
  mock.timers.tick(1000);
  assert.equal(controller.status().regions.footer.showing.text, 'HI');

  controller.clear('footer');
  assert.equal(controller.status().regions.footer.showing, null);
  assert.equal(controller.status().regions.footer.phase, 'blank');
});

test('a geometry change does not blank a band holding its last page', (t) => {
  const { board, controller } = setup(t, 10, 2, 1);
  controller.enqueue('HI', { region: 'footer' });
  board.settle('footer');
  mock.timers.tick(1000);
  assert.deepEqual(controller.status().lines[1], 'HI        ');

  // Dragging any geometry control must not wipe what someone deliberately
  // left standing in a band.
  controller.configure({ cols: 6 });

  assert.deepEqual(
    controller.status().lines[1],
    'HI    ',
    'the held page must be re-laid for the new grid, not blanked',
  );
});

test('a queued message picks up a later change to the dwell', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');

  // The dwell must resolve when the page settles, not be snapshotted at
  // enqueue - otherwise changing it appears to do nothing until the queue
  // drains and refills.
  controller.configure({ dwellMs: 5000 });

  board.settle();
  mock.timers.tick(1000);
  assert.equal(controller.status().showing.text, 'ALPHA', 'still holding on the longer dwell');

  mock.timers.tick(4000);
  assert.equal(controller.status().showing.text, 'BRAVO');
});

test('a message sent with its own dwell keeps it', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA', { dwellMs: 500 });
  controller.enqueue('BRAVO');
  controller.configure({ dwellMs: 5000 });

  board.settle();
  mock.timers.tick(500);
  assert.equal(controller.status().showing.text, 'BRAVO', 'an explicit dwell wins over the band');
});

/* ---- repeat ---- */

/** Play the showing message through to its end. */
function playThrough(board, region = 'main') {
  board.settle(region);
  mock.timers.tick(1000);
}

test('a repeating message plays again, keeping its id', (t) => {
  const { board, controller } = setup(t);
  const added = controller.enqueue('ALPHA', { repeat: true });
  assert.equal(controller.status().showing.id, added.id);

  playThrough(board);

  const showing = controller.status().showing;
  assert.equal(showing.text, 'ALPHA', 'it comes straight back round');
  assert.equal(showing.id, added.id, 'and it is the same message, not a copy');
  assert.equal(controller.status().regions.main.showing.cycles, 1);
});

test('repeating messages take turns rather than hogging the band', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA', { repeat: true });
  controller.enqueue('BRAVO');
  controller.enqueue('CHARLIE', { repeat: true });

  const order = [];
  for (let i = 0; i < 5; i += 1) {
    order.push(controller.status().showing.text);
    playThrough(board);
  }
  assert.deepEqual(order, ['ALPHA', 'BRAVO', 'CHARLIE', 'ALPHA', 'CHARLIE'],
    'BRAVO plays once; the repeating pair keeps cycling');
});

test('a lone repeating message does not leave the band idle for a turn', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA', { repeat: true });
  playThrough(board);
  assert.equal(controller.status().showing.text, 'ALPHA', 'recycled before the pump, not after');
});

test('recycling is not refused when the queue is at its limit', (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const board = stubBoard(10, 1);
  const controller = new Controller(board, { dwellMs: 1000, maxQueue: 2 });

  controller.enqueue('ALPHA', { repeat: true }); // becomes current
  controller.enqueue('BRAVO');
  controller.enqueue('CHARLIE');
  assert.equal(controller.status().queue.length, 2, 'the queue is full');

  // ALPHA finishing must be able to rejoin: over a full cycle a recycle is
  // length-neutral, so it cannot push the queue past a size it already had.
  assert.doesNotThrow(() => playThrough(board));
  assert.equal(controller.status().queue.items.at(-1).text, 'ALPHA');
});

test('a repeating message that jumped the queue does not keep jumping it', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('URGENT', { priority: 'now', repeat: true });
  assert.equal(controller.status().showing.text, 'URGENT');

  playThrough(board);
  assert.equal(controller.status().showing.text, 'ALPHA', 'it goes to the back, not the front');
  assert.equal(
    controller.status().queue.items.at(-1).text,
    'URGENT',
    'and recycles as an ordinary message',
  );
  assert.equal(controller.status().queue.items.at(-1).priority, undefined);
});

test('flush leaves a repeating message cycling, and clear stops it', (t) => {
  const { board, controller } = setup(t);
  controller.enqueue('ALPHA', { repeat: true });
  controller.enqueue('BRAVO');

  assert.equal(controller.flush(), 1, 'BRAVO was pending');
  playThrough(board);
  assert.equal(controller.status().showing.text, 'ALPHA', 'flush does not stop a cycle');

  controller.clear();
  assert.equal(controller.status().showing, null, 'clear is what stops it');
  assert.equal(controller.status().regions.main.phase, 'blank');
});

test('a repeating message re-lays for a new grid after it has been round', (t) => {
  const { board, controller } = setup(t, 20, 2);
  controller.enqueue('HELLO THERE', { repeat: true, align: 'right' });
  playThrough(board);

  controller.configure({ cols: 11 });
  const queued = controller.queue[0] ?? controller.current;
  assert.equal(queued.diagnostics.cols, 11, 'its options survived the recycle');
  assert.equal(queued.pages[0][0], 'HELLO THERE');
});

test('repeat is reported only when it is set', (t) => {
  const { controller } = setup(t);
  controller.enqueue('ALPHA', { repeat: true });
  controller.enqueue('BRAVO');
  const [bravo] = controller.status().queue.items;
  assert.equal(bravo.repeat, undefined, 'no noise on ordinary messages');
  assert.equal(controller.status().showing.repeat, true);
});

/* ---- per-band dwell ---- */

test('a band can hold for longer than the rest of the board', (t) => {
  const { board, controller } = setup(t, 10, 4, 1);
  controller.configure({ regions: { footer: { dwellMs: 5000 } } });

  controller.enqueue('ALPHA');
  controller.enqueue('BRAVO');
  controller.enqueue('ONE', { region: 'footer' });
  controller.enqueue('TWO', { region: 'footer' });

  board.settle('main');
  board.settle('footer');
  mock.timers.tick(1000);

  assert.equal(controller.status().regions.main.showing.text, 'BRAVO', 'main used the board dwell');
  assert.equal(controller.status().regions.footer.showing.text, 'ONE', 'the footer is still holding');

  mock.timers.tick(4000);
  assert.equal(controller.status().regions.footer.showing.text, 'TWO');
});

test('changing the board dwell leaves a band override alone', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  controller.configure({ regions: { footer: { dwellMs: 5000 } } });
  controller.configure({ dwellMs: 300 });

  const status = controller.status();
  assert.equal(status.dwellMs, 300, 'the board default moved');
  assert.equal(status.regions.main.dwellMs, 300, 'and so did the band that inherits');
  assert.equal(status.regions.footer.dwellMs, 5000, 'but not the one that does not');
  assert.equal(status.regions.footer.dwellOverride, 5000);
  assert.equal(status.regions.main.dwellOverride, null);
});

test('a band override can be handed back', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  controller.configure({ dwellMs: 300, regions: { footer: { dwellMs: 5000 } } });
  assert.equal(controller.status().regions.footer.dwellMs, 5000);

  controller.configure({ regions: { footer: { dwellMs: null } } });
  assert.equal(controller.status().regions.footer.dwellMs, 300, 'back to the board default');
  assert.equal(controller.status().regions.footer.dwellOverride, null);
});

test('an override survives its band being removed and put back', (t) => {
  const { controller } = setup(t, 10, 4, 1);
  controller.configure({ regions: { footer: { dwellMs: 5000 } } });

  controller.configure({ footerRows: 0 });
  assert.equal(controller.status().regions.footer, undefined);

  controller.configure({ footerRows: 1 });
  assert.equal(
    controller.status().regions.footer.dwellMs,
    5000,
    'fiddling with the rows slider must not silently lose it',
  );
});

test('a band can be created and configured in one call', (t) => {
  const { controller } = setup(t, 10, 4, 0);
  controller.configure({ footerRows: 1, regions: { footer: { dwellMs: 8000 } } });
  assert.equal(controller.status().regions.footer.dwellMs, 8000);
});

test('configuring a band that does not exist is refused', (t) => {
  const { controller } = setup(t, 10, 4, 0);
  try {
    controller.configure({ regions: { footer: { dwellMs: 5000 } } });
    assert.fail('should have thrown');
  } catch (error) {
    assert.match(error.message, /unknown region: footer/);
    assert.equal(error.status, 422);
  }
});

test('capabilities advertise what this build can do', (t) => {
  const { controller } = setup(t);
  const caps = controller.capabilities();
  assert.equal(caps.repeat, true);
  assert.equal(caps.perBandDwell, true);
  assert.equal(caps.maxDwellMs, 600000);
});
