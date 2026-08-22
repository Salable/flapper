import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { Flapper } from '@/components/flapper/Flapper';
import { SiteFooter } from '@/components/SiteFooter';

export default function LoginPage() {
  return (
    <div className="app-shell">
      <main className="landing">
      <div className="landing-hero"><Flapper text="FLAPPER" tilePx={30} /></div>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
