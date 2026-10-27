/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep `next dev` from writing its own block into AGENTS.md when an AI agent runs it.
  agentRules: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  async rewrites() {
    // The browser always calls /api on its own origin (see src/lib/apiBase.ts).
    // In production Caddy handles /api before the request ever reaches Next, so
    // this rewrite is what serves every other topology — `npm run dev`, the E2E
    // Compose stack, and anyone running the published image without a reverse
    // proxy in front of it.
    //
    // rewrites() runs when the server starts, not at build time, so this target
    // is a normal runtime environment variable. That is the whole point: it can
    // be changed on a published image, which NEXT_PUBLIC_API_URL cannot.
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_PROXY_TARGET || 'http://backend:8000'}/api/:path*`,
      },
    ];
  },
  async redirects() {
    // Common English guesses for the operator's legal pages; not permanent, as a deployment may add pages here later.
    return [
      { source: '/privacy', destination: '/datenschutz', permanent: false },
      { source: '/imprint', destination: '/impressum', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Keep page documents out of the browser's back/forward cache so the
        // Back button cannot re-display authenticated pages after sign-out.
        // Hashed build assets under /_next/ keep their long-lived caching.
        source: '/((?!_next/|landing/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        // Public screenshots hold no account data. Not hashed, so cached for a day rather than forever.
        source: '/landing/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ];
  },
}

module.exports = nextConfig
