/**
 * The get-in-touch queue: refusals that turned into conversations.
 *
 * Same seam as every other query layer - `db` first, so it runs against an
 * in-memory PGlite under `node --test`.
 *
 * Nothing here decides anything commercial. What may be asked for is
 * lib/salable/licence.mjs REQUESTABLE; whether a plan gets cut is a person.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { licenceRequests } from './schema.mjs';
import { newBoardId } from '../broker/tokens.mjs';

/** The shape handed to callers - never the raw row. */
function shape(row) {
  return {
    id: row.id,
    userId: row.userId,
    need: row.need,
    message: row.message,
    contact: row.contact ?? null,
    handledAt: row.handledAt instanceof Date ? row.handledAt.getTime() : (row.handledAt ?? null),
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
  };
}

/**
 * The request this account already has open for this need, if any.
 *
 * Asking twice for the same thing is not a second lead, it is someone who
 * hit the same wall again - and a queue with duplicates in it is a queue
 * people stop reading. The caller tells them it is already with us.
 */
export async function openRequestFor(db, userId, need) {
  const [row] = await db
    .select()
    .from(licenceRequests)
    .where(
      and(eq(licenceRequests.userId, userId), eq(licenceRequests.need, need), isNull(licenceRequests.handledAt)),
    )
    .limit(1);
  return row ? shape(row) : null;
}

export async function createRequest(db, { userId, need, message, contact = null }) {
  const [row] = await db
    .insert(licenceRequests)
    .values({ id: newBoardId(), userId, need, message, contact })
    .returning();
  return shape(row);
}

/** This account's own requests, newest first - what the licence page shows. */
export async function listRequestsFor(db, userId) {
  const rows = await db
    .select()
    .from(licenceRequests)
    .where(eq(licenceRequests.userId, userId))
    .orderBy(desc(licenceRequests.createdAt));
  return rows.map(shape);
}

/**
 * Everything open, oldest first, for whoever is answering them - the RFC's
 * commitment is a reply within a day or two, so the oldest is the one that
 * matters. Read by tools/licence-requests.mjs, never by a request handler.
 */
export async function listOpenRequests(db) {
  const rows = await db
    .select()
    .from(licenceRequests)
    .where(isNull(licenceRequests.handledAt))
    .orderBy(licenceRequests.createdAt);
  return rows.map(shape);
}

/** Mark one answered. Only ever done by a person, from the tool. */
export async function markHandled(db, id) {
  const [row] = await db
    .update(licenceRequests)
    .set({ handledAt: new Date() })
    .where(eq(licenceRequests.id, id))
    .returning();
  return row ? shape(row) : null;
}
