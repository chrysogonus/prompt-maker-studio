/** The legal pages a deployment may provide. Client-safe; the reader lives in lib/legal.ts. */
export const LEGAL_PAGES = [
  { slug: 'impressum', label: 'Impressum', href: '/impressum' },
  { slug: 'datenschutz', label: 'Privacy policy', href: '/datenschutz' },
  { slug: 'nutzungsbedingungen', label: 'Terms of service', href: '/terms' },
] as const;

export type LegalSlug = (typeof LEGAL_PAGES)[number]['slug'];
