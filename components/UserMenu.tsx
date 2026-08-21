'use client';

import { signOut } from '@/lib/auth-client';
import { Button, LinkButton } from '@/components/ui/Button';

/**
 * The signed-in person's corner of the AppBar: their name (a link to the
 * account area, not plain text), Docs, Sign out. One component so every
 * signed-in page agrees on what the global nav is.
 */
export function UserMenu({ userName, current }: { userName: string; current?: 'dashboard' | 'account' }) {
  return (
    <>
      {current === 'account' ? (
        <LinkButton href="/dashboard">Dashboard</LinkButton>
      ) : (
        <a className="app-bar-user" href="/account" title="Your account">
          {userName}
        </a>
      )}
      <LinkButton href="/docs">Docs</LinkButton>
      <Button
        onClick={async () => {
          await signOut();
          // Full navigation: nothing of this account may linger in the
          // router cache for the next person to sign in.
          window.location.assign('/');
        }}
      >
        Sign out
      </Button>
    </>
  );
}
