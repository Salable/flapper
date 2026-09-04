import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { AccountClient } from '@/components/AccountClient';

export const dynamic = 'force-dynamic';

/**
 * The account area: who you are, what is connected to you. Profile,
 * connected apps, privacy - Licence lives at its own URL (a real Stripe
 * portal link and a request form, more than a section here should hold),
 * reached through AccountNav's own sidebar rather than a section on this
 * page linking out to it.
 */
export default async function AccountPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/account');
  return (
    <AccountClient
      user={{
        name: session.user.name || '',
        email: session.user.email,
        createdAt: new Date(session.user.createdAt).getTime(),
        marketingConsent: Boolean((session.user as { marketingConsent?: boolean }).marketingConsent),
      }}
    />
  );
}
