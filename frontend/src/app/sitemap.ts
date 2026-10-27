import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/branding';
import { GUIDES, GUIDES_INDEX } from '@/lib/guides';
import { TOOLS, TOOLS_INDEX } from '@/lib/tools';
import { GALLERY, GALLERY_INDEX, galleryPath } from '@/lib/gallery';

// Read on each request: FRONTEND_URL is runtime config, not built in.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return [
    { url: `${origin}/` },
    { url: `${origin}${GUIDES_INDEX.path}` },
    ...Object.values(GUIDES).map(({ path, updated }) => ({ url: `${origin}${path}`, lastModified: updated })),
    ...[TOOLS_INDEX, ...Object.values(TOOLS), GALLERY_INDEX].map(({ path }) => ({ url: `${origin}${path}` })),
    ...GALLERY.map(({ slug }) => ({ url: `${origin}${galleryPath(slug)}` })),
  ];
}
