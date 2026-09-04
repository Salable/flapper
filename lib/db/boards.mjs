/**
 * Board queries. Every function takes `db` first - the same testable seam the
 * API handlers use for `broker` - so the whole layer runs against an in-memory
 * PGlite under `node --test`.
 */

import { and, desc, eq } from 'drizzle-orm';
import { boards, queueItems, queues, user } from './schema.mjs';
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

/**
 * Public, active boards for the homepage gallery - real content, never
 * fabricated. Free boards have no `board_private` entitlement to begin with,
 * so this is naturally most of what exists; most-recent first, capped for a
 * page that has to stay light. Joined to the owner's name for attribution;
 * there is no per-user avatar in this schema, so the gallery derives an
 * emoji from `ownerId` itself rather than adding one.
 *
 * Also joined to the board's *current* queue item, left-joined because an
 * idle board (currentItemId null, or its item since removed) has none. The
 * gallery shows what a board is actually saying, not its title - a name is
 * an identifier, not the thing anyone came to look at.
 *
 * `config` rides along too, unresolved: the board's real screen, card size
 * and theme pack are the caller's to resolve (lib/board/geometry.mjs,
 * lib/board/board-theme.mjs) the same way the dashboard does, so a gallery
 * card is honestly that board's shape, not a generic strip standing in for it.
 */
export async function listPublic(db, { limit = 12 } = {}) {
  return db
    .select({
      id: boards.id,
      slug: boards.slug,
      name: boards.name,
      ownerId: boards.ownerId,
      ownerName: user.name,
      currentPayload: queueItems.payload,
      config: boards.config,
    })
    .from(boards)
    .innerJoin(user, eq(boards.ownerId, user.id))
    .leftJoin(queueItems, eq(queueItems.id, boards.currentItemId))
    .where(and(eq(boards.private, false), eq(boards.status, 'active')))
    .orderBy(desc(boards.createdAt))
    .limit(limit);
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

/**
 * Read-merge-write of the display config; `regions` merges per band.
 *
 * Row-locked inside a transaction, not a bare read then write: two callers
 * changing different fields at once - the sidebar now puts Theme, Screen,
 * Card size and Fidget within a click of each other, where they used to be a
 * page apart - both read the same starting config before either wrote, and
 * whichever write landed second silently discarded the other's change.
 * Reproduced by construction: two reads before either write, one survives.
 * `for('update')` serialises the second caller behind the first's commit
 * instead of letting them race.
 */
export async function setConfig(db, id, patch) {
  return db.transaction(async (tx) => {
    const [board] = await tx.select().from(boards).where(eq(boards.id, id)).for('update');
    if (!board) return null;
    const regions = { ...board.config?.regions };
    for (const [bandId, band] of Object.entries(patch.regions ?? {})) {
      regions[bandId] = { ...regions[bandId], ...band };
    }
    const config = { ...board.config, ...patch };
    if (patch.regions !== undefined) config.regions = regions;
    await tx.update(boards).set({ config, updatedAt: new Date() }).where(eq(boards.id, id));
    return config;
  });
}

/**
 * Read-modify-write of `config.interrupters` - the same reasoning as
 * `setConfig`'s own `regions` merge, for a field that isn't a per-key
 * merge but a whole list a caller means to replace outright (save/delete/
 * reorder each compute the complete next array). Calling `setConfig` with
 * a precomputed array does not close this race the way it looks like it
 * would: `setConfig` re-reads `board.config` fresh under its own lock, but
 * `patch.interrupters` was still built from whatever the *caller* read
 * before that lock existed, so the fresh read never actually factors in -
 * two saves close together can still silently lose one. `mutate` runs
 * against a row-locked, transaction-fresh read instead, so the array it
 * returns is genuinely the next state, not a stale guess. `mutate` may
 * throw (`reject`, typically) to abort the whole write - the row lock is
 * released on rollback, same as any other failed transaction.
 */
export async function updateInterrupters(db, id, mutate) {
  return db.transaction(async (tx) => {
    const [board] = await tx.select().from(boards).where(eq(boards.id, id)).for('update');
    if (!board) return null;
    const interrupters = mutate(board.config?.interrupters ?? []);
    const config = { ...board.config, interrupters };
    await tx.update(boards).set({ config, updatedAt: new Date() }).where(eq(boards.id, id));
    return config;
  });
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
