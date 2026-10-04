/** The legal pages a deployment may provide. Client-safe; the reader lives in lib/legal.ts. */
export const LEGAL_PAGES = [
  { slug: 'impressum', label: 'Impressum' },
  { slug: 'datenschutz', label: 'Datenschutz' },
] as const;

export type LegalSlug = (typeof LEGAL_PAGES)[number]['slug'];
