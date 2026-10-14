import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/branding';

// Read on each request: FRONTEND_URL is runtime config, not built in.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${siteUrl()}/` }];
}
