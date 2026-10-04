import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageTitle } from '@/lib/branding';
import { readLegalPage } from '@/lib/legal';

export const metadata: Metadata = {
  title: pageTitle('Impressum'),
};

// Read on each request: the file is mounted at runtime, not built in.
export const dynamic = 'force-dynamic';

export default async function ImpressumPage() {
  const html = await readLegalPage('impressum');
  if (html === null) notFound();
  // Trusted: written by the operator on their own server, like the Caddyfile.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
