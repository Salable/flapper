/**
 * Board queries. Every function takes `db` first - the same testable seam the
 * API handlers use for `broker` - so the whole layer runs against an in-memory
 * PGlite under `node --test`.
 */

import { eq } from 'drizzle-orm';
import { boards, queues } from './schema.mjs';
import { newBoardId, newWriteToken } from '../broker/tokens.mjs';
import { validateSlug, generateSlug } from './slugs.mjs';
import { reject } from '../api/errors.mjs';

/** Postgres unique_violation. */
function isUniqueViolation(error) {
  return error?.code === '23505' || error?.cause?.code === '23505' || /unique/i.test(String(error?.message));
}

/**
 * Create a board. A caller-chosen slug that collides is a 422; a generated
 * one retries with fresh randomness.
 */
export async function createBoard(db, { ownerId, name = '', slug, type = 'live', config = {} } = {}) {
  const chosen = slug !== undefined ? validateSlug(slug) : null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = newBoardId();
    const row = {
      id,
      slug: chosen ?? generateSlug(),
      name,
      ownerId,
      type,
      config,
      apiKey: newWriteToken(),
      // A board is born with its own queue, sharing the board's id.
      queueId: id,
    };
    try {
      return await db.transaction(async (tx) => {
        await tx.insert(queues).values({ id, ownerId });
        const [created] = await tx.insert(boards).values(row).returning();
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (chosen) reject(`slug "${chosen}" is taken`, 422);
    }
  }
  reject('could not find a free slug; try naming one', 422);
}

export async function getBySlug(db, slug) {
  const [row] = await db.select().from(boards).where(eq(boards.slug, slug)).limit(1);
  return row ?? null;
}

export async function getById(db, id) {
  const [row] = await db.select().from(boards).where(eq(boards.id, id)).limit(1);
  return row ?? null;
}

/**
 * The board a presented API key belongs to. Keys are 32 random bytes, so an
 * exact-match lookup is also an authentication: holding the key names the
 * board. The MCP endpoint's whole access model rests on this.
 */
export async function getByApiKey(db, apiKey) {
  if (!apiKey) return null;
  const [row] = await db.select().from(boards).where(eq(boards.apiKey, apiKey)).limit(1);
  return row ?? null;
}

export async function listByOwner(db, ownerId) {
  return db.select().from(boards).where(eq(boards.ownerId, ownerId)).orderBy(boards.createdAt);
}

/** Rename, re-slug, or change privacy. Unknown keys are the caller's 422. */
export async function updateBoard(db, id, { name, slug, private: isPrivate, status } = {}) {
  const patch = { updatedAt: new Date() };
  if (status !== undefined) {
    if (!['active', 'deactivated'].includes(status)) {
      reject('status must be active or deactivated', 422);
    }
    patch.status = status;
  }
  if (name !== undefined) {
    if (typeof name !== 'string' || name.length > 80) reject('name must be a string of at most 80 characters', 422);
    patch.name = name;
  }
  if (slug !== undefined) patch.slug = validateSlug(slug);
  if (isPrivate !== undefined) {
    if (typeof isPrivate !== 'boolean') reject('private must be true or false', 422);
    patch.private = isPrivate;
  }
  try {
    const [updated] = await db.update(boards).set(patch).where(eq(boards.id, id)).returning();
    return updated ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) reject(`slug "${slug}" is taken`, 422);
    throw error;
  }
}

/** Read-merge-write of the display config; `regions` merges per band. */
export async function setConfig(db, id, patch) {
  const board = await getById(db, id);
  if (!board) return null;
  const regions = { ...board.config?.regions };
  for (const [bandId, band] of Object.entries(patch.regions ?? {})) {
    regions[bandId] = { ...regions[bandId], ...band };
  }
  const config = { ...board.config, ...patch };
  if (patch.regions !== undefined) config.regions = regions;
  await db.update(boards).set({ config, updatedAt: new Date() }).where(eq(boards.id, id));
  return config;
}

/** Mint a fresh key; the old one stops working with this statement. */
export async function rotateKey(db, id) {
  const [updated] = await db
    .update(boards)
    .set({ apiKey: newWriteToken(), updatedAt: new Date() })
    .where(eq(boards.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteBoard(db, id) {
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(boards).where(eq(boards.id, id)).returning();
    if (deleted.length === 0) return false;
    // A queue nobody renders any more goes with its last board (cascade takes
    // the items); a shared queue survives for its remaining boards.
    const { queueId } = deleted[0];
    const [remaining] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.queueId, queueId))
      .limit(1);
    if (!remaining) await tx.delete(queues).where(eq(queues.id, queueId));
    return true;
  });
}
