/**
 * Queue entity plumbing. Since 4.0 a queue is strictly 1:1 with its board
 * (multi-board attachment lives in attic/ - shared boards are the same slug
 * on many screens, not many boards on one queue). The row survives as the
 * items' home and the future seam for per-section queues.
 */

import { asc, eq } from 'drizzle-orm';
import { boards, queues } from './schema.mjs';

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
