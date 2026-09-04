import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { listRequestsFor } from '@/lib/db/licence-requests.mjs';
import { BOARD_TYPES } from '@/lib/board-types/index.mjs';
import { accountAllowance, REQUESTABLE, FREE_ALLOWANCE } from '@/lib/salable/licence.mjs';
import { LicenceClient, type LicenceView, type PlanCompare } from '@/components/LicenceClient';

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

  // Free vs Bespoke, as the plan actually is - read from FREE_ALLOWANCE
  // (lib/salable/licence.mjs) rather than this viewer's own allowance, so
  // it describes the two plans themselves, not whichever one they happen
  // to be on. No numbers beyond what's already true in the code: there is
  // no public price list, so this names what each plan covers, never what
  // it costs.
  const compare: PlanCompare = {
    boards: String(FREE_ALLOWANCE.maxBoards),
    slidesPerBoard: String(FREE_ALLOWANCE.maxQueueItems),
    // 'shared' stays a registered type for boards that already use it, but
    // is no longer offered anywhere a board is created (templates.mjs) - so
    // it's not named here as something asking for a plan would get you.
    extraType: BOARD_TYPES.get('scheduled')?.name ?? 'Scheduled',
  };

  return (
    <LicenceClient
      userName={session.user.name || session.user.email}
      accountEmail={session.user.email}
      licence={licence}
      requestable={REQUESTABLE}
      need={need}
      requests={requests}
      compare={compare}
    />
  );
}
