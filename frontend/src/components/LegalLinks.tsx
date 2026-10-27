'use client';

import { useEffect, useState } from 'react';
import { LEGAL_PAGES, type LegalSlug } from '@/lib/legal-pages';

/**
 * Links to whichever legal pages this deployment provides (see lib/legal.ts).
 * Server pages pass `pages` so the links are in the HTML crawlers read; client
 * screens leave it out and render nothing until /legal.json answers. Nothing at
 * all renders when the operator has configured none.
 */
export default function LegalLinks({ className, pages }: { className?: string; pages?: readonly LegalSlug[] }) {
  const [available, setAvailable] = useState<readonly LegalSlug[]>(pages ?? []);

  useEffect(() => {
    if (pages) return;
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
  }, [pages]);

  const links = LEGAL_PAGES.filter(({ slug }) => available.includes(slug));
  if (links.length === 0) return null;

  return (
    <span className={className}>
      {links.map(({ slug, label, href }) => (
        <a key={slug} href={href}>
          {label}
        </a>
      ))}
    </span>
  );
}
