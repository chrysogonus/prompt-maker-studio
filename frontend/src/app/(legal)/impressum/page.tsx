import { notFound } from 'next/navigation';
import { legalMetadata, readLegalPage } from '@/lib/legal';

export function generateMetadata() {
  return legalMetadata('Impressum', '/impressum', 'Legal notice: who runs this site and how to contact them.');
}

// Read on each request: the file is mounted at runtime, not built in.
export const dynamic = 'force-dynamic';

export default async function ImpressumPage() {
  const html = await readLegalPage('impressum');
  if (html === null) notFound();
  // Trusted: written by the operator on their own server, like the Caddyfile.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
