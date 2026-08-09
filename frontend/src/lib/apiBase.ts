/**
 * Base URL every backend call is built on.
 *
 * Empty by default, which makes every request same-origin: the callers already
 * prefix their paths with `/api`, so `''` yields `/api/auth/login` and the
 * browser resolves it against whatever host is serving the app. That is what
 * lets one published image work on any domain — a `NEXT_PUBLIC_*` value is
 * compiled into the client bundle at build time and cannot be changed when the
 * container starts, so anything baked in here would be wrong for every
 * self-hoster who did not build the image themselves.
 *
 * Two things forward the request to the backend from there:
 *   - in production, Caddy handles `/api/*` on the app domain (see Caddyfile);
 *   - everywhere else, the Next server rewrites `/api/*` to API_PROXY_TARGET
 *     (see next.config.js), which is read at startup and so stays configurable
 *     at runtime.
 *
 * NEXT_PUBLIC_API_URL still overrides this for a local frontend run against a
 * backend on another origin (`npm run dev` with the API on :8000). It must not
 * be set for a published image.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
