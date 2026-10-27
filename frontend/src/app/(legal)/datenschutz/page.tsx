import { notFound } from 'next/navigation';
import { legalMetadata, readLegalPage } from '@/lib/legal';

export function generateMetadata() {
  return legalMetadata('Datenschutz', '/datenschutz', 'Privacy policy: what this site stores, why it does so, and your rights.');
}

// Read on each request: the file is mounted at runtime, not built in.
export const dynamic = 'force-dynamic';

export default async function DatenschutzPage() {
  const html = await readLegalPage('datenschutz');
  if (html === null) notFound();
  // Trusted: written by the operator on their own server, like the Caddyfile.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
