import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { MiniBoard } from '@/components/ui/MiniBoard';

export default function LoginPage() {
  return (
    <main className="landing">
      <div className="landing-hero"><MiniBoard text="FLAPPER" size="md" animate /></div>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
