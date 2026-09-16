import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { publicBaseUrl } from '@/lib/auth';
import './design-tokens.css';
import './board.css';
import './ui.css';

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--next-font-mono',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--next-font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  // Every board page's own og:image is a relative /api/... URL - this is
  // what resolves it to something Slack/LinkedIn's crawlers, which fetch
  // server-to-server with no notion of "relative to what page", can follow.
  metadataBase: new URL(publicBaseUrl()),
  title: 'Flapper',
  description: 'A split-flap board for the web: create a board, put it on a wall, drive it over REST.',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexMono.variable} ${plexSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
