#!/usr/bin/env node
/**
 * Lift the stale `queueCap: 1` off boards made from the old `sign` template.
 *
 * The sign template used to pin a board to one message permanently; Dan
 * removed that pin on 2026-09-04 (lib/board-types/templates.mjs, "lost the
 * permanent queueCap: 1 pin"). Boards created before then still carry the
 * pin in `config.queueCap`, so a free account entitled to three slides is
 * told "This board holds 1 message and is full" and never reaches them.
 *
 *   SALABLE_API_KEY=... DATABASE_URL=... \
 *   node tools/unpin-sign-queuecap.mjs [--apply]
 *
 * Dry run by default - it prints what it would touch and changes nothing.
 * Pass --apply to write.
 *
 * Why it asks Salable per board: the licence ceiling on slides is applied
 * *once*, in createBoard (lib/api/handlers.mjs - `config.queueCap =
 * Math.min(...)`), and written into the row. Nothing clamps on read. So a
 * tool that wrote the type's own default straight in would hand a free
 * account five slides instead of the three its plan covers. The cap each
 * board lands on is min(the type's default, this owner's maxQueueItems).
 *
 * Deliberately narrow, because `queueCap: 1` is also a legal thing to
 * choose: only live boards created strictly before the cutoff are eligible,
 * so a board someone pinned to 1 on purpose afterwards is never touched.
 * It only ever raises a cap, never lowers one. Idempotent: a board already
 * off 1 is skipped, so re-running is a no-op.
 *
 * `unpinBoards` is exported and takes its allowance lookup as an argument
 * so tests/unpin-sign-queuecap.test.mjs can drive it against a real
 * database without a Salable key - the CLI below is the only part that
 * needs the network.
 */

import { eq } from 'drizzle-orm';
import { boards } from '../lib/db/schema.mjs';
import { getBoardType } from '../lib/board-types/index.mjs';

/** The commit that removed the pin. Anything newer chose its own cap. */
export const CUTOFF = new Date('2026-09-04T00:00:00Z');

/**
 * @param db            drizzle handle
 * @param allowanceOf   (ownerId) => allowance, as accountAllowance returns
 * @param apply         false (the default) plans without writing
 * @returns {{lifted: [], skipped: []}} one entry per board considered
 */
export async function unpinBoards(db, { allowanceOf, apply = false } = {}) {
  const rows = await db.select().from(boards);
  const lifted = [];
  const skipped = [];

  /** One lookup per owner, not per board. */
  const seen = new Map();
  const allowance = async (ownerId) => {
    if (!seen.has(ownerId)) seen.set(ownerId, await allowanceOf(ownerId));
    return seen.get(ownerId);
  };

  for (const board of rows) {
    if (board.type !== 'live') continue;
    if (board.config?.queueCap !== 1) continue;
    if (board.createdAt >= CUTOFF) {
      skipped.push({ slug: board.slug, why: `created ${board.createdAt.toISOString().slice(0, 10)} - after the cutoff, its own choice` });
      continue;
    }

    // The type's own declared default, rather than a second copy of 5 here.
    const fallback = getBoardType(board.type)?.createParams?.find((p) => p.key === 'queueCap')?.default ?? 5;
    const { maxQueueItems } = await allowance(board.ownerId);
    const cap = Math.min(fallback, maxQueueItems);

    if (!(cap > 1)) {
      skipped.push({ slug: board.slug, why: `licence covers ${maxQueueItems} - nothing to lift` });
      continue;
    }

    if (apply) {
      const config = { ...board.config, queueCap: cap };
      await db.update(boards).set({ config, updatedAt: new Date() }).where(eq(boards.id, board.id));
    }
    lifted.push({ slug: board.slug, from: 1, to: cap, ceiling: cap < fallback ? maxQueueItems : null });
  }

  return { lifted, skipped };
}

/* ---- CLI ---- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import('../lib/db/client.mjs');
  const { accountAllowance } = await import('../lib/salable/licence.mjs');
  const { salableClient } = await import('../lib/salable/client.mjs');

  const apply = process.argv.includes('--apply');

  // Without a key every account reads as free, which would cap a paid
  // owner's board at three. It only ever raises, so that is not a loss -
  // but it is still the wrong number, and silently. Refuse instead.
  if (!salableClient().configured) {
    console.error('unpin-sign-queuecap: SALABLE_API_KEY is not set - every account would read as free');
    process.exit(1);
  }

  const { lifted, skipped } = await unpinBoards(await getDb(), { allowanceOf: accountAllowance, apply });
  for (const row of skipped) console.log(`  skip   ${row.slug.padEnd(24)} ${row.why}`);
  for (const row of lifted) {
    console.log(`  ${apply ? 'lift  ' : 'would '} ${row.slug.padEnd(24)} queueCap ${row.from} -> ${row.to}${row.ceiling ? ` (licence ceiling ${row.ceiling})` : ''}`);
  }
  console.log(
    `\nunpin-sign-queuecap: ${lifted.length} board(s) ${apply ? 'lifted' : 'to lift'}` +
      `${skipped.length ? `, ${skipped.length} left alone` : ''}${apply ? '' : ' (dry run - pass --apply to write)'}`,
  );
  process.exit(0);
}
