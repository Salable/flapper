import { redirect } from 'next/navigation';

// This board's control room moved to /manage - "settings" stopped
// describing it the moment Board and Interruptions joined what used to be
// a pure config page. Kept as a redirect, not deleted outright, so a
// bookmark or an old link still lands somewhere real.
export default async function SettingsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/b/${slug}/manage`);
}
