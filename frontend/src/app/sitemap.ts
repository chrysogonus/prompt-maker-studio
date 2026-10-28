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
    { url: `${origin}/about` },
    { url: `${origin}${GUIDES_INDEX.path}` },
    ...Object.values(GUIDES).map(({ path, updated }) => ({ url: `${origin}${path}`, lastModified: updated })),
    { url: `${origin}${TOOLS_INDEX.path}` },
    ...Object.values(TOOLS).map(({ path, updated }) => ({ url: `${origin}${path}`, lastModified: updated })),
    { url: `${origin}${GALLERY_INDEX.path}` },
    ...GALLERY.map(({ slug, updated }) => ({ url: `${origin}${galleryPath(slug)}`, lastModified: updated })),
    ...LEGAL_PAGES.filter(({ slug }) => legal.includes(slug)).map(({ href }) => ({ url: `${origin}${href}` })),
  ];
}
