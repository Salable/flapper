/**
 * The server-side queue: the durable list of messages a board plays, and the
 * playback head that says which one is on the glass.
 *
 * Invariants this module owns:
 *  - Play order is (position, id). Positions are floats with gaps; a closing
 *    gap triggers a whole-board reindex inside the same transaction.
 *  - `boards.currentItemId` + `currentState` + `currentEpoch` are only ever
 *    changed inside a transaction holding the board row FOR UPDATE, and every
 *    reassignment bumps the epoch - that is what makes a display's `advance`
 *    idempotent per play (loops reuse item ids, so id alone is not enough).
 *  - A drained non-loop item is *kept* with state 'holding': the last page
 *    stays on the glass across reloads, exactly like the desktop app held it.
 *    'idle' means cleared or never used - a blank glass.
 *  - Loop items return to the tail when played. A looping item whose payload
 *    keeps failing on displays is deleted after 3 consecutive failures.
 */

import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { boards, queues, queueItems } from './schema.mjs';
import { newBoardId as newItemId } from '../broker/tokens.mjs';
import { reject } from '../api/errors.mjs';
import { getBoardType } from '../board-types/index.mjs';
import { inArray } from 'drizzle-orm';

/** The playback machine a board runs; unknown types read as live (they are
 * gated to the paused presentation before any mutation reaches here). */
function playbackOf(board) {
  return getBoardType(board.type)?.playback ?? 'live';
}

const GAP = 1024;
const MIN_GAP = 1e-6;
export const MAX_ITEMS = 500;
const MAX_ITEM_ERRORS = 3;

/* ---- reads ---- */

export async function listQueue(db, boardId) {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) return null;
  const [queue] = await db.select().from(queues).where(eq(queues.id, board.queueId)).limit(1);
  const items = await db
    .select()
    .from(queueItems)
    .where(eq(queueItems.queueId, board.queueId))
    .orderBy(asc(queueItems.position), asc(queueItems.id));
  // The board's head moves per play; the queue row moves per content change.
  // The freshest of the two is the snapshot's "something changed" watermark.
  const updatedAt =
    new Date(board.updatedAt) > new Date(queue.updatedAt) ? board.updatedAt : queue.updatedAt;
  return {
    items,
    queueId: queue.id,
    type: board.type,
    status: board.status,
    currentItemId: board.currentItemId,
    currentState: board.currentState,
    epoch: board.currentEpoch,
    queueUpdatedAt: updatedAt,
  };
}

/* ---- transaction plumbing ---- */

/**
 * Lock order everywhere: board row first, then its queue row. Item mutations
 * on a shared timed queue serialize on the queue; head mutations on the board.
 */
async function lockBoard(tx, boardId) {
  const [board] = await tx.select().from(boards).where(eq(boards.id, boardId)).for('update');
  if (!board) reject('unknown board', 404);
  const [queue] = await tx.select().from(queues).where(eq(queues.id, board.queueId)).for('update');
  if (!queue) reject('this board has no queue (data inconsistency)', 500);
  return { ...board, queue };
}

function orderedItems(tx, queueId) {
  return tx
    .select()
    .from(queueItems)
    .where(eq(queueItems.queueId, queueId))
    .orderBy(asc(queueItems.position), asc(queueItems.id));
}

async function itemCount(tx, queueId) {
  const [row] = await tx
    .select({ count: sql`count(*)::int` })
    .from(queueItems)
    .where(eq(queueItems.queueId, queueId));
  return row.count;
}

/**
 * Enforce the type's cap before an insert. 'roll' deletes the oldest
 * pending message to make room (a ticker); 'reject' answers 429. MAX_ITEMS
 * stays as the absolute backstop regardless of type.
 */
async function makeRoom(tx, board) {
  const type = getBoardType(board.type);
  const count = await itemCount(tx, board.queueId);
  if (count >= MAX_ITEMS) {
    reject(`queue is full (${MAX_ITEMS} items); flush or clear before adding more`, 429);
  }
  if (!type) return;
  const cap = type.queuePolicy.cap(board.config ?? {});
  if (!Number.isFinite(cap) || count < cap) return;
  if (type.queuePolicy.onFull === 'reject') {
    reject(`this board holds ${cap} ${cap === 1 ? 'message' : 'messages'}; remove one first`, 429);
  }
  // Roll: the oldest waiting message falls off. Never the one on the glass.
  const items = await orderedItems(tx, board.queueId);
  const victim = items.find(
    (item) =>
      item.id !== board.currentItemId &&
      type.queuePolicy.isPending(item, { currentItemId: board.currentItemId }),
  );
  if (!victim) {
    reject(
      cap === 1
        ? 'this board holds one message and it is the one on the glass; clear it first, or raise the queue size'
        : `this board holds ${cap} messages and none can be rolled off`,
      429,
    );
  }
  await tx.delete(queueItems).where(eq(queueItems.id, victim.id));
}

/** Renumber the whole queue to fresh gaps. Same-transaction only. */
async function reindex(tx, boardId) {
  const items = await orderedItems(tx, boardId);
  for (let i = 0; i < items.length; i += 1) {
    await tx
      .update(queueItems)
      .set({ position: (i + 1) * GAP })
      .where(eq(queueItems.id, items[i].id));
  }
  return orderedItems(tx, boardId);
}

/** A position strictly between two neighbours, reindexing if the gap closed. */
async function positionBetween(tx, boardId, beforePos, afterPos) {
  if (beforePos === null && afterPos === null) return GAP;
  if (beforePos === null) return afterPos - GAP;
  if (afterPos === null) return beforePos + GAP;
  if (afterPos - beforePos < MIN_GAP) return null; // caller reindexes and retries
  return beforePos + (afterPos - beforePos) / 2;
}

/**
 * Set the head when nothing is playing: promotes the lowest item, deleting a
 * held row first (its standing page is over the moment something new arrives).
 * Board row must be locked. Returns the patch applied to the board, or null.
 */
async function promoteIfNotPlaying(tx, board) {
  // The head is live-machine machinery; clock boards derive from time.
  if (playbackOf(board) !== 'live') return null;
  if (board.currentState === 'playing') return null;
  if (board.currentState === 'holding' && board.currentItemId) {
    await tx.delete(queueItems).where(eq(queueItems.id, board.currentItemId));
  }
  const [head] = await orderedItems(tx, board.queueId);
  const patch = head
    ? { currentItemId: head.id, currentState: 'playing', currentEpoch: board.currentEpoch + 1 }
    : { currentItemId: null, currentState: 'idle', currentEpoch: board.currentEpoch + 1 };
  await tx.update(boards).set({ ...patch, updatedAt: new Date() }).where(eq(boards.id, board.id));
  return patch;
}

async function touchBoard(tx, boardId) {
  await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, boardId));
}

async function touchQueue(tx, queueId) {
  await tx.update(queues).set({ updatedAt: new Date() }).where(eq(queues.id, queueId));
}

/* ---- inserts ---- */

function newRow(
  queueId,
  { payload, loop = false, source = 'api', schedule = null, computedDurationMs = null, expiresAtMs = null },
  position,
) {
  return {
    id: newItemId(),
    queueId,
    position,
    payload,
    loop: Boolean(loop),
    schedule,
    computedDurationMs,
    expiresAtMs,
    source,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Append to the tail (priority: normal). */
export async function appendItem(db, boardId, entry) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    await makeRoom(tx, board);
    const [last] = await tx
      .select({ max: sql`max(position)` })
      .from(queueItems)
      .where(eq(queueItems.queueId, board.queueId));
    const row = newRow(board.queueId, entry, (Number(last?.max) || 0) + GAP);
    await tx.insert(queueItems).values(row);
    const promoted = await promoteIfNotPlaying(tx, board);
    await touchQueue(tx, board.queueId);
    if (!promoted) await touchBoard(tx, boardId);
    return { item: row, promoted: Boolean(promoted) };
  });
}

/** Insert just after the current item (priority: next). */
export async function insertAfterCurrent(db, boardId, entry) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    await makeRoom(tx, board);
    let items = await orderedItems(tx, board.queueId);
    const place = async () => {
      const anchor = board.currentItemId
        ? items.findIndex((item) => item.id === board.currentItemId)
        : -1;
      const before = anchor >= 0 ? items[anchor].position : null;
      const after =
        anchor + 1 < items.length ? items[anchor + 1].position : null;
      return positionBetween(tx, board.queueId, before, after);
    };
    let position = await place();
    if (position === null) {
      items = await reindex(tx, board.queueId);
      position = await place();
    }
    const row = newRow(board.queueId, entry, position);
    await tx.insert(queueItems).values(row);
    const promoted = await promoteIfNotPlaying(tx, board);
    await touchQueue(tx, board.queueId);
    if (!promoted) await touchBoard(tx, boardId);
    return { item: row, promoted: Boolean(promoted) };
  });
}

/**
 * Play immediately (priority: now): the new item becomes current; whatever was
 * playing stays next in order. Stacked nows nest - each lands ahead of the
 * last preempted item. Page-resume from the 1.x desktop is deliberately gone.
 */
export async function setNow(db, boardId, entry) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    await makeRoom(tx, board);
    // A held row's standing page is over; it must not replay after the now.
    if (playbackOf(board) === 'live' && board.currentState === 'holding' && board.currentItemId) {
      await tx.delete(queueItems).where(eq(queueItems.id, board.currentItemId));
    }
    const [first] = await orderedItems(tx, board.queueId);
    const row = newRow(board.queueId, entry, first ? first.position - GAP : GAP);
    await tx.insert(queueItems).values(row);
    await touchQueue(tx, board.queueId);
    if (playbackOf(board) === 'live') {
      await tx
        .update(boards)
        .set({
          currentItemId: row.id,
          currentState: 'playing',
          currentEpoch: board.currentEpoch + 1,
          updatedAt: new Date(),
        })
        .where(eq(boards.id, boardId));
    }
    return { item: row, promoted: true };
  });
}

/* ---- edits ---- */

export async function updateItem(
  db,
  boardId,
  itemId,
  { payload, loop, schedule, computedDurationMs, expiresAtMs },
) {
  const patch = { updatedAt: new Date() };
  if (payload !== undefined) patch.payload = payload;
  if (loop !== undefined) {
    if (typeof loop !== 'boolean') reject('loop must be true or false', 422);
    patch.loop = loop;
  }
  if (schedule !== undefined) patch.schedule = schedule;
  if (computedDurationMs !== undefined) patch.computedDurationMs = computedDurationMs;
  if (expiresAtMs !== undefined) patch.expiresAtMs = expiresAtMs;
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    const [updated] = await tx
      .update(queueItems)
      .set(patch)
      .where(and(eq(queueItems.queueId, board.queueId), eq(queueItems.id, itemId)))
      .returning();
    if (!updated) reject('unknown queue item', 404);
    await touchQueue(tx, board.queueId);
    return updated;
  });
}

/** Remove one item. Removing the current item is a skip: the head takes over. */
export async function removeItem(db, boardId, itemId) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    const deleted = await tx
      .delete(queueItems)
      .where(and(eq(queueItems.queueId, board.queueId), eq(queueItems.id, itemId)))
      .returning();
    if (deleted.length === 0) reject('unknown queue item', 404);
    await touchQueue(tx, board.queueId);
    if (playbackOf(board) === 'live' && board.currentItemId === itemId) {
      await promoteIfNotPlaying(tx, { ...board, currentState: 'idle', currentItemId: null });
    }
    return true;
  });
}

/** Move an item to sit after `afterId`; null means the front of the pending queue. */
export async function reorderItem(db, boardId, itemId, afterId) {
  if (itemId === afterId) reject('an item cannot be placed after itself', 422);
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    let items = await orderedItems(tx, board.queueId);
    const find = (id) => items.find((item) => item.id === id);
    if (!find(itemId)) reject('unknown queue item', 404);
    if (afterId !== null && !find(afterId)) reject('unknown afterId item', 404);
    if (itemId === board.currentItemId) {
      reject('the playing item cannot be reordered; it is already on the glass', 422);
    }

    const place = () => {
      const rest = items.filter((item) => item.id !== itemId);
      // null = front of what is *pending*: right after the current item when
      // one is playing, else the absolute head.
      let anchorIndex;
      if (afterId !== null) anchorIndex = rest.findIndex((item) => item.id === afterId);
      else if (board.currentState === 'playing' && board.currentItemId) {
        anchorIndex = rest.findIndex((item) => item.id === board.currentItemId);
      } else anchorIndex = -1;
      const before = anchorIndex >= 0 ? rest[anchorIndex].position : null;
      const after = anchorIndex + 1 < rest.length ? rest[anchorIndex + 1].position : null;
      return positionBetween(tx, board.queueId, before, after);
    };
    let position = await place();
    if (position === null) {
      items = await reindex(tx, board.queueId);
      position = await place();
    }
    const [moved] = await tx
      .update(queueItems)
      .set({ position, updatedAt: new Date() })
      .where(eq(queueItems.id, itemId))
      .returning();
    await touchQueue(tx, board.queueId);
    return moved;
  });
}

/* ---- playback ---- */

/**
 * A display reports that it finished (or failed) the item it was playing.
 * Idempotent per play: unless (itemId, epoch) match the board's current head,
 * nothing changes and the caller gets the truth to converge on - that is how
 * two mirrored displays advance a queue exactly once per item.
 */
export async function advance(db, boardId, itemId, epoch, { error } = {}) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    // Clock boards are time-driven: nothing to advance, and an old display
    // reporting completions must be a harmless no-op.
    if (playbackOf(board) !== 'live') return snapshot(tx, board, false);
    const stale =
      board.currentItemId !== itemId ||
      board.currentEpoch !== epoch ||
      board.currentState !== 'playing';
    if (stale) {
      return snapshot(tx, board, false);
    }

    const current = await getItemTx(tx, board.queueId, itemId);
    if (!current) {
      // Row vanished under us (shouldn't happen inside the lock); recover.
      const patch = await promoteIfNotPlaying(tx, { ...board, currentState: 'idle' });
      return snapshot(tx, { ...board, ...patch }, true);
    }

    if (error) {
      const failures = current.errorCount + 1;
      if (!current.loop || failures >= MAX_ITEM_ERRORS) {
        await tx.delete(queueItems).where(eq(queueItems.id, current.id));
      } else {
        await moveToTail(tx, board.queueId, current, { errorCount: failures });
      }
    } else if (current.loop) {
      await moveToTail(tx, board.queueId, current, { errorCount: 0 });
    }
    // A finished non-loop item is dealt with below: kept when it is the last
    // thing on the board (holding), deleted once something else takes over.

    const [head] = (await orderedItems(tx, board.queueId)).filter(
      (item) => error || current.loop || item.id !== current.id,
    );

    let patch;
    if (head) {
      if (!error && !current.loop) {
        await tx.delete(queueItems).where(eq(queueItems.id, current.id));
      }
      patch = { currentItemId: head.id, currentState: 'playing', currentEpoch: board.currentEpoch + 1 };
    } else if (!error && !current.loop) {
      // Nothing else to play: hold the finished item's last page on the glass.
      patch = { currentItemId: current.id, currentState: 'holding', currentEpoch: board.currentEpoch + 1 };
    } else {
      patch = { currentItemId: null, currentState: 'idle', currentEpoch: board.currentEpoch + 1 };
    }
    patch.updatedAt = new Date();
    await tx.update(boards).set(patch).where(eq(boards.id, boardId));
    return snapshot(tx, { ...board, ...patch }, true);
  });
}

async function moveToTail(tx, queueId, item, extra = {}) {
  const [last] = await tx
    .select({ max: sql`max(position)` })
    .from(queueItems)
    .where(eq(queueItems.queueId, queueId));
  await tx
    .update(queueItems)
    .set({ position: (Number(last?.max) || 0) + GAP, ...extra, updatedAt: new Date() })
    .where(eq(queueItems.id, item.id));
}

async function getItemTx(tx, queueId, itemId) {
  const [item] = await tx
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.queueId, queueId), eq(queueItems.id, itemId)))
    .limit(1);
  return item ?? null;
}

async function snapshot(tx, board, advanced) {
  const current = board.currentItemId
    ? await getItemTx(tx, board.queueId, board.currentItemId)
    : null;
  return {
    advanced,
    current,
    currentState: board.currentState,
    epoch: board.currentEpoch,
    queueUpdatedAt: board.updatedAt,
  };
}

/* ---- bulk ---- */

/** Drop what is pending; the type's queue policy says what "pending" means. */
export async function flushPending(db, boardId) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    const type = getBoardType(board.type);
    const items = await orderedItems(tx, board.queueId);
    const doomed = items.filter(
      (item) =>
        item.id !== board.currentItemId &&
        (type ? type.queuePolicy.isPending(item, { currentItemId: board.currentItemId }) : true),
    );
    if (doomed.length > 0) {
      await tx.delete(queueItems).where(inArray(queueItems.id, doomed.map((item) => item.id)));
    }
    await touchQueue(tx, board.queueId);
    return doomed.length;
  });
}

/** Stop everything and blank: the considered full stop, on every attached board. */
export async function clearQueue(db, boardId) {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    const gone = await tx
      .delete(queueItems)
      .where(eq(queueItems.queueId, board.queueId))
      .returning({ id: queueItems.id });
    await tx
      .update(boards)
      .set({
        currentItemId: null,
        currentState: 'idle',
        currentEpoch: sql`${boards.currentEpoch} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(boards.queueId, board.queueId));
    await touchQueue(tx, board.queueId);
    return gone.length;
  });
}

/** Clock types: drop items whose materialized end-of-life has passed. */
export async function sweepExpired(db, queueId, nowMs) {
  const gone = await db
    .delete(queueItems)
    .where(
      and(
        eq(queueItems.queueId, queueId),
        isNotNull(queueItems.expiresAtMs),
        sql`${queueItems.expiresAtMs} < ${nowMs}`,
      ),
    )
    .returning({ id: queueItems.id });
  return gone.length;
}
