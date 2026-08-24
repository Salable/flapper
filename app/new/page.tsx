import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { BOARD_TYPES } from '@/lib/board-types/index.mjs';
import { TEMPLATE_FAMILIES } from '@/lib/board-types/templates.mjs';
import { NewBoardClient, type FamilyMeta } from '@/components/NewBoardClient';

export const dynamic = 'force-dynamic';

/**
 * /new - choosing a board. The rails and their cards come from the template
 * registry; the types' create params come from the board-type registry. The
 * page serializes both and the client does the choosing.
 */
export default async function NewBoardPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/new');

  // The names this account already uses, so a template's prefilled name
  // never makes a twin (lib/board-types/names.mjs).
  const db = await getDb();
  const takenNames = (await listByOwner(db, session.user.id)).map((board: any) => String(board.name ?? ''));

  const types = [...BOARD_TYPES.values()].map((type: any) => ({
    id: type.id,
    name: type.name,
    tagline: type.tagline,
    description: type.description,
    capabilities: type.capabilities,
    sample: type.sample,
    recommended: type.recommended,
    tier: type.tier,
    createParams: type.createParams,
  }));

  const families: FamilyMeta[] = TEMPLATE_FAMILIES.map((family: any) => ({
    id: family.id,
    title: family.title,
    blurb: family.blurb,
    templates: family.templates.map((template: any) => ({
      id: template.id,
      type: template.type,
      name: template.name,
      defaultName: template.defaultName,
      tagline: template.tagline,
      poster: template.poster,
      what: template.what,
      recommended: template.recommended,
      tier: template.tier,
      starter: template.starter,
      params: template.params,
      config: template.config,
      seedCount: template.seed.length,
    })),
  }));

  return (
    <NewBoardClient
      userName={session.user.name || session.user.email}
      types={types}
      families={families}
      takenNames={takenNames}
    />
  );
}
