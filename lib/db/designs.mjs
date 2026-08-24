/**
 * Design queries: the theme packs an account made, as opposed to the ones that
 * ship with the build.
 *
 * Same seam as every other query layer - `db` first, so the whole thing runs
 * against an in-memory PGlite under `node --test`.
 *
 * A design is stored as a whole validated pack, not as a diff. A board's
 * override is a diff because it is an edit *of* a preset; a design is a thing
 * in its own right, and whichever preset it was forked from is a note in
 * `basedOn` rather than something the renderer ever has to resolve.
 */

import { and, desc, eq } from 'drizzle-orm';
import { designs } from './schema.mjs';
import { newBoardId } from '../broker/tokens.mjs';
import { reject } from '../api/errors.mjs';

/** How many designs one account may keep. Generous; a guard, not a product limit. */
export const MAX_DESIGNS = 60;

/** The shape handed to callers - never the raw row. */
function shape(row) {
  return {
    id: row.id,
    name: row.name,
    pack: row.pack,
    basedOn: row.basedOn ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
  };
}

/** Every design this account has, newest edit first. */
export async function listDesigns(db, ownerId) {
  const rows = await db
    .select()
    .from(designs)
    .where(eq(designs.ownerId, ownerId))
    .orderBy(desc(designs.updatedAt));
  return rows.map(shape);
}

/**
 * One design, but only if it belongs to this account.
 *
 * Ownership is part of the lookup rather than a check afterwards, so there is
 * no path that reads somebody else's row and then decides what to do about it.
 */
export async function getDesign(db, ownerId, id) {
  const [row] = await db
    .select()
    .from(designs)
    .where(and(eq(designs.id, id), eq(designs.ownerId, ownerId)))
    .limit(1);
  return row ? shape(row) : null;
}

/** Create one. `pack` must already have passed validatePack. */
export async function createDesign(db, { ownerId, name, pack, basedOn = null } = {}) {
  const held = await db.select({ id: designs.id }).from(designs).where(eq(designs.ownerId, ownerId));
  if (held.length >= MAX_DESIGNS) {
    reject(`this account already has ${held.length} designs; the limit is ${MAX_DESIGNS}`, 409);
  }
  const row = {
    id: newBoardId(),
    ownerId,
    name,
    pack,
    basedOn,
  };
  const [created] = await db.insert(designs).values(row).returning();
  return shape(created);
}

/**
 * Change a design's name, its pack, or both. Returns null when there is
 * nothing of that id on this account, so the caller answers 404 rather than
 * silently succeeding.
 */
export async function updateDesign(db, ownerId, id, { name, pack } = {}) {
  const patch = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (pack !== undefined) patch.pack = pack;
  const [row] = await db
    .update(designs)
    .set(patch)
    .where(and(eq(designs.id, id), eq(designs.ownerId, ownerId)))
    .returning();
  return row ? shape(row) : null;
}

/**
 * Delete one. Boards wearing it keep working: a board stores the resolved pack
 * it was given, not a reference, so deleting a design cannot blank a wall.
 */
export async function deleteDesign(db, ownerId, id) {
  const [row] = await db
    .delete(designs)
    .where(and(eq(designs.id, id), eq(designs.ownerId, ownerId)))
    .returning({ id: designs.id });
  return Boolean(row);
}
