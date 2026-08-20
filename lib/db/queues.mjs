/**
 * Queue entity operations: the queue as a first-class thing a board renders,
 * per RFC 0002. Boards attach many-to-one; attach order (queueAttachedAt)
 * decides which board stays live when entitlements shrink.
 *
 * Mode is an explicit toggle - 'live' (one board, display-driven; the 3.0
 * machine) or 'timed' (Plus; compiled cycle, clock-driven, shareable).
 * Sharing REQUIRES timed; switching back to live requires being down to one
 * board. Entitlement *checks* live in the handlers - this layer enforces
 * structural invariants only, so a downgrade never corrupts anything.
 */

import { asc, eq } from 'drizzle-orm';
import { boards, queues, queueItems } from './schema.mjs';
import { newBoardId as newQueueId } from '../broker/tokens.mjs';
import { reject } from '../api/errors.mjs';

export async function getQueueRow(db, queueId) {
  const [row] = await db.select().from(queues).where(eq(queues.id, queueId)).limit(1);
  return row ?? null;
}

/** Attached boards, earliest attachment first (the "primary" is index 0). */
export async function boardsOfQueue(db, queueId) {
  return db
    .select()
    .from(boards)
    .where(eq(boards.queueId, queueId))
    .orderBy(asc(boards.queueAttachedAt), asc(boards.id));
}

export async function setMode(db, queueId, { mode, dormancyDisplay }) {
  const patch = { updatedAt: new Date() };
  if (mode !== undefined) {
    if (!['live', 'timed'].includes(mode)) reject('mode must be live or timed', 422);
    patch.mode = mode;
  }
  if (dormancyDisplay !== undefined) {
    if (!['card', 'blank'].includes(dormancyDisplay)) {
      reject('dormancyDisplay must be card or blank', 422);
    }
    patch.dormancyDisplay = dormancyDisplay;
  }
  return db.transaction(async (tx) => {
    const [queue] = await tx.select().from(queues).where(eq(queues.id, queueId)).for('update');
    if (!queue) reject('unknown queue', 404);
    if (patch.mode === 'live') {
      const attached = await boardsOfQueue(tx, queueId);
      if (attached.length > 1) {
        reject('a live queue drives exactly one board; detach the others first', 422);
      }
    }
    const [updated] = await tx.update(queues).set(patch).where(eq(queues.id, queueId)).returning();
    return updated;
  });
}

export async function setCompiled(db, queueId, { durations, cycleMs, anchorMs }) {
  return db.transaction(async (tx) => {
    for (const [itemId, durationMs] of durations) {
      await tx
        .update(queueItems)
        .set({ computedDurationMs: Math.round(durationMs) })
        .where(eq(queueItems.id, itemId));
    }
    await tx
      .update(queues)
      .set({ cycleMs: Math.round(cycleMs), cycleAnchorMs: Math.round(anchorMs), updatedAt: new Date() })
      .where(eq(queues.id, queueId));
  });
}

/**
 * Attach a board to this queue. Structural rules: the target queue must be
 * timed, and the arriving board's own queue must be empty (its items would
 * otherwise be silently destroyed - the caller is told to clear first). The
 * old solo queue is deleted once vacated.
 */
export async function attachBoard(db, queueId, boardId) {
  return db.transaction(async (tx) => {
    const [queue] = await tx.select().from(queues).where(eq(queues.id, queueId)).for('update');
    if (!queue) reject('unknown queue', 404);
    if (queue.mode !== 'timed') {
      reject('boards can only share a time-based queue; switch the queue to timed first', 422);
    }
    const [board] = await tx.select().from(boards).where(eq(boards.id, boardId)).for('update');
    if (!board) reject('unknown board', 404);
    if (board.queueId === queueId) reject('that board is already on this queue', 422);

    const leftovers = await tx
      .select({ id: queueItems.id })
      .from(queueItems)
      .where(eq(queueItems.queueId, board.queueId))
      .limit(1);
    if (leftovers.length > 0) {
      reject('that board’s own queue still has messages; clear it before attaching', 422);
    }
    const oldQueueId = board.queueId;
    await tx
      .update(boards)
      .set({
        queueId,
        queueAttachedAt: new Date(),
        // The head belongs to live playback; a timed board derives from the clock.
        currentItemId: null,
        currentState: 'idle',
        currentEpoch: board.currentEpoch + 1,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId));
    const remaining = await boardsOfQueue(tx, oldQueueId);
    if (remaining.length === 0) await tx.delete(queues).where(eq(queues.id, oldQueueId));
    return getQueueRow(tx, queueId);
  });
}

/** Detach a board onto a fresh, empty live queue of its own. */
export async function detachBoard(db, boardId) {
  return db.transaction(async (tx) => {
    const [board] = await tx.select().from(boards).where(eq(boards.id, boardId)).for('update');
    if (!board) reject('unknown board', 404);
    const siblings = await boardsOfQueue(tx, board.queueId);
    if (siblings.length < 2) {
      reject('this board is not sharing a queue; nothing to detach from', 422);
    }
    const fresh = {
      id: newQueueId(),
      ownerId: board.ownerId,
      name: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await tx.insert(queues).values(fresh);
    await tx
      .update(boards)
      .set({
        queueId: fresh.id,
        queueAttachedAt: new Date(),
        currentItemId: null,
        currentState: 'idle',
        currentEpoch: board.currentEpoch + 1,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId));
    return fresh;
  });
}
