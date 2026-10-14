import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/branding';

// Read on each request: FRONTEND_URL is runtime config, not built in.
export const dynamic = 'force-dynamic';

// Only the landing and legal pages are public; everything else sits behind
// sign-in and would be indexed as an empty sign-in form.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/library', '/editor', '/settings', '/dashboard', '/playground', '/oauth', '/reset-password'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
