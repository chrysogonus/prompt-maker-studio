import type { Metadata } from 'next';
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { pageTitle } from '@/lib/branding';
import './globals.css';
import { THEME_SCRIPT } from '@/lib/theme';
import ThemeSync from '@/components/ui/ThemeSync';

// Self-hosted at build time, so no request leaves for a font CDN at runtime.
const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' });
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: pageTitle(),
  description: 'A prompt library and template editor for reusable AI prompts.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The inline script applies a saved dark theme before first paint, on every page.
    <html lang="en" data-theme="light" className={`${hanken.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body><ThemeSync />{children}</body>
    </html>
  );
}
