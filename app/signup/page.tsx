import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { MiniBoard } from '@/components/ui/MiniBoard';

export default function SignupPage() {
  return (
    <main className="landing">
      <div className="landing-hero"><MiniBoard text="FLAPPER" size="md" animate /></div>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </main>
  );
}
