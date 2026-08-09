import type { Metadata } from 'next';
import { pageTitle } from '@/lib/branding';
import './globals.css';

export const metadata: Metadata = {
  title: pageTitle(),
  description: 'Generate structured prompts with ease',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
