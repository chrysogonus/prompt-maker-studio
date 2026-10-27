import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/branding';
import { GUIDES, GUIDES_INDEX } from '@/lib/guides';
import { TOOLS, TOOLS_INDEX } from '@/lib/tools';
import { GALLERY, GALLERY_INDEX, galleryPath } from '@/lib/gallery';
import { availableLegalPages } from '@/lib/legal';
import { LEGAL_PAGES } from '@/lib/legal-pages';

// Read on each request: FRONTEND_URL is runtime config, not built in.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const legal = await availableLegalPages();
  return [
    { url: `${origin}/` },
    { url: `${origin}${GUIDES_INDEX.path}` },
    ...Object.values(GUIDES).map(({ path, updated }) => ({ url: `${origin}${path}`, lastModified: updated })),
    ...[TOOLS_INDEX, ...Object.values(TOOLS), GALLERY_INDEX].map(({ path }) => ({ url: `${origin}${path}` })),
    ...GALLERY.map(({ slug }) => ({ url: `${origin}${galleryPath(slug)}` })),
    ...LEGAL_PAGES.filter(({ slug }) => legal.includes(slug)).map(({ href }) => ({ url: `${origin}${href}` })),
  ];
}
