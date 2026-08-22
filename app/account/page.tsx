import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { AccountClient } from '@/components/AccountClient';

export const dynamic = 'force-dynamic';

/**
 * The account area: who you are, what is connected to you. Profile,
 * connected apps; billing and tier land here when they exist, rather than
 * anywhere bolted to the dashboard.
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
