'use client';

import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { Chip } from '@/components/ui/bits';
import { LinkButton } from '@/components/ui/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { LicenceRequestForm } from '@/components/LicenceRequestForm';
import { formatDay } from '@/lib/format';

export type LicenceView = {
  /** null means unlimited. */
  maxBoards: number | null;
  boardsInUse: number;
  types: { id: string; name: string; included: boolean }[];
  privateBoards: boolean;
  /** False when the account holds no licence at all - it cannot create anything. */
  licensed: boolean;
  /** True when this build has no Salable account behind it: nothing is gated. */
  ungated: boolean;
};

export function LicenceClient({
  userName,
  accountEmail,
  licence,
  requestable,
  need,
  requests,
}: {
  userName: string;
  accountEmail: string;
  licence: LicenceView;
  requestable: Record<string, string>;
  need?: string;
  requests: { id: string; need: string; message: string; handledAt: number | null; createdAt: number }[];
}) {
  const boards = licence.maxBoards === null ? 'Unlimited' : String(licence.maxBoards);

  return (
    <div className="app-shell">
      <AppBar right={<UserMenu userName={userName} current="account" />} />
      <main className="dash settings">
        <header className="dash-head">
          <h1 className="dash-title">Your licence</h1>
        </header>

        <section className="settings-block">
          <h2>What it covers</h2>
          {licence.ungated ? (
            <p className="ui-hint">
              This build has no Salable account behind it, so nothing is gated: every board type, no
              board limit, private boards included.
            </p>
          ) : !licence.licensed ? (
            <p className="error">
              This account holds no licence yet, so it cannot create a board. Signing out and back in
              usually fixes it; if not, tell us below and we will sort it.
            </p>
          ) : null}
          <dl className="licence-facts">
            <dt>Boards</dt>
            <dd>
              {boards}
              {licence.maxBoards !== null && ` (${licence.boardsInUse} in use)`}
            </dd>
            <dt>Board types</dt>
            <dd>
              {licence.types.map((type) => (
                <Chip key={type.id} tone={type.included ? undefined : 'amber'}>
                  {type.name}
                  {type.included ? '' : ' — ask'}
                </Chip>
              ))}
            </dd>
            <dt>Private boards</dt>
            <dd>{licence.privateBoards ? 'Included' : 'Not on this licence'}</dd>
          </dl>
          <p className="ui-hint">
            Flapper runs on <a href="https://salable.app">Salable</a>, which is what decides all of
            the above — and what you would use to do this to your own product. How Flapper is wired
            to it is written down in the repo.
          </p>
        </section>

        <section className="settings-block">
          <h2>Need more?</h2>
          <p className="ui-hint">
            There is no price list. Every plan we sell is cut for the person asking, so tell us what
            you are doing and we will come back to you — we read these ourselves.
          </p>
          <LicenceRequestForm requestable={requestable} need={need} accountEmail={accountEmail} />
        </section>

        {requests.length > 0 && (
          <section className="settings-block">
            <h2>What you have asked us</h2>
            <ul className="licence-asks">
              {requests.map((ask) => (
                <li key={ask.id}>
                  <strong>{requestable[ask.need] ?? ask.need}</strong>
                  <Chip tone={ask.handledAt === null ? 'amber' : undefined}>
                    {ask.handledAt === null ? 'With us' : 'Answered'}
                  </Chip>
                  <span className="ui-hint"> asked {formatDay(ask.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="rail-detail-actions">
          <LinkButton href="/dashboard">Back to boards</LinkButton>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
