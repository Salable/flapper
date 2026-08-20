import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { Flapper } from '@/components/flapper/Flapper';

export default function LoginPage() {
  return (
    <main className="landing">
      <div className="landing-hero"><Flapper text="FLAPPER" tilePx={30} /></div>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
