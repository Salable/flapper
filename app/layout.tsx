import type { Metadata, Viewport } from 'next';
import './board.css';

export const metadata: Metadata = {
  title: 'Flapper',
  description: 'A split-flap board for the web: create a board, put it on a wall, drive it over REST.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
