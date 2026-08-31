import type { Metadata, Viewport } from 'next';
import type { JSX, ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'NextGen — Assistant',
  description: 'Conversation is the interface; screens are what the AI drives.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0d10' },
    { media: '(prefers-color-scheme: light)', color: '#f4f5f6' },
  ],
  // Explicitly NOT `maximum-scale: 1`. Pinch-zoom is an accessibility feature,
  // and 200% text without clipping is an acceptance criterion for this package.
  width: 'device-width',
  initialScale: 1,
};

/**
 * Resolve the theme before first paint.
 *
 * A stored preference wins; otherwise the OS decides. Running this inline is
 * the only way to avoid a flash of the wrong theme — the alternative is an
 * effect, which by definition runs after the first paint.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = localStorage.getItem('nextgen-theme');
    var dark = stored ? stored === 'dark'
      : !window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <div className="ground" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
