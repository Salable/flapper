import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export default function SignupPage() {
  return (
    <main className="landing">
      <h1>FLAPPER</h1>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </main>
  );
}
