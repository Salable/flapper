import { Suspense } from 'react';
import { ConsentForm } from '@/components/ConsentForm';
import { Flapper } from '@/components/flapper/Flapper';

export default function ConsentPage() {
  return (
    <main className="landing">
      <div className="landing-hero"><Flapper text="CONNECT" tilePx={30} /></div>
      <Suspense>
        <ConsentForm />
      </Suspense>
    </main>
  );
}
