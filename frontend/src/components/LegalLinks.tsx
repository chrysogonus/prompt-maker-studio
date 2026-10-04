'use client';

import { useEffect, useState } from 'react';
import { LEGAL_PAGES, type LegalSlug } from '@/lib/legal-pages';

/**
 * Links to whichever legal pages this deployment provides (see lib/legal.ts).
 * Renders nothing until /legal.json answers, and nothing at all when the
 * operator has configured none.
 */
export default function LegalLinks({ className }: { className?: string }) {
  const [available, setAvailable] = useState<LegalSlug[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/legal.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { pages?: unknown } | null) => {
        if (!cancelled && Array.isArray(body?.pages)) setAvailable(body.pages as LegalSlug[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const links = LEGAL_PAGES.filter(({ slug }) => available.includes(slug));
  if (links.length === 0) return null;

  return (
    <span className={className}>
      {links.map(({ slug, label }) => (
        <a key={slug} href={`/${slug}`}>
          {label}
        </a>
      ))}
    </span>
  );
}
