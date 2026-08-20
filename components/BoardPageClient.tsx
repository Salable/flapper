'use client';

import dynamic from 'next/dynamic';

// The board reads localStorage at first render and draws to a canvas; there is
// nothing for the server to prerender.
const BoardApp = dynamic(() => import('@/components/BoardApp').then((m) => m.BoardApp), {
  ssr: false,
});

export function BoardPageClient(props: {
  slug: string;
  apiBase: string;
  boardKey: string | null;
  isOwner: boolean;
}) {
  return <BoardApp {...props} />;
}
