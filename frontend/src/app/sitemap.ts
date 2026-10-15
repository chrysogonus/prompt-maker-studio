import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/branding';
import { GUIDES, GUIDES_INDEX } from '@/lib/guides';

// Read on each request: FRONTEND_URL is runtime config, not built in.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return [
    { url: `${origin}/` },
    ...[GUIDES_INDEX, ...Object.values(GUIDES)].map(({ path }) => ({ url: `${origin}${path}` })),
  ];
}
