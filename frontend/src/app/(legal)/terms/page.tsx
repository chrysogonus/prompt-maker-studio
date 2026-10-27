import { notFound } from 'next/navigation';
import { legalMetadata, readLegalPage } from '@/lib/legal';

export function generateMetadata() {
  return legalMetadata('Terms of Service', '/terms', 'Terms of service for using this site and its prompt library.');
}

// Read on each request: the file is mounted at runtime, not built in.
export const dynamic = 'force-dynamic';

export default async function TermsPage() {
  const html = await readLegalPage('nutzungsbedingungen');
  if (html === null) notFound();
  // Trusted: written by the operator on their own server, like the Caddyfile.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
