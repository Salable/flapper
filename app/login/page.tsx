import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export default function LoginPage() {
  return (
    <main className="landing">
      <h1>FLAPPER</h1>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
