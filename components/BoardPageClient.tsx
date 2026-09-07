'use client';

import dynamic from 'next/dynamic';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

// The board draws to a canvas from live data; there is nothing for the server
// to prerender.
const BoardApp = dynamic(() => import('@/components/BoardApp').then((m) => m.BoardApp), {
  ssr: false,
});

export function BoardPageClient(props: {
  slug: string;
  apiBase: string;
  boardKey: string | null;
  displayToken: string;
  initialTheme: { rev: string; pack: ThemePack };
  watermark: boolean;
}) {
  return <BoardApp {...props} />;
}
