import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { listRequestsFor } from '@/lib/db/licence-requests.mjs';
import { BOARD_TYPES } from '@/lib/board-types/index.mjs';
import { accountAllowance, REQUESTABLE } from '@/lib/salable/licence.mjs';
import { LicenceClient, type LicenceView } from '@/components/LicenceClient';

export const dynamic = 'force-dynamic';

/**
 * /account/licence - what this account may do, and how to ask for more.
 *
 * Where every 402 sends people (`getInTouch` in the refusal body), which is
 * why `?need=` prefills the form: someone who arrives here has already been
 * told no once and should not have to describe it again.
 */
export default async function LicencePage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/account/licence');

  const db = await getDb();
  const [allowance, boards, requests] = await Promise.all([
    accountAllowance(session.user.id),
    listByOwner(db, session.user.id),
    listRequestsFor(db, session.user.id),
  ]);

  const licence: LicenceView = {
    // Infinity does not survive JSON; null is the wire's word for unlimited.
    maxBoards: Number.isFinite(allowance.maxBoards) ? allowance.maxBoards : null,
    boardsInUse: boards.length,
    types: [...BOARD_TYPES.values()].map((type: any) => ({
      id: type.id,
      name: type.name,
      included: !allowance.types || allowance.types.includes(type.id),
    })),
    privateBoards: allowance.privateBoards,
    licensed: allowance.licensed,
    ungated: allowance.source === 'unlicensed',
  };

  const { need } = await searchParams;

  return (
    <LicenceClient
      userName={session.user.name || session.user.email}
      accountEmail={session.user.email}
      licence={licence}
      requestable={REQUESTABLE}
      need={need}
      requests={requests}
    />
  );
}
