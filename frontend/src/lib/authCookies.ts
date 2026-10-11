/** Readable half of the backend's double-submit CSRF pair. */
const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * The session token lives in an httpOnly cookie the browser attaches itself, so
 * every request has to opt into sending credentials. Cross-origin fetches drop
 * cookies without this.
 */
export const CREDENTIALS: RequestCredentials = 'include';

/**
 * Read the CSRF token the server set alongside the session cookie.
 *
 * This one is deliberately readable — echoing it in a header is what proves the
 * request came from a page on this site rather than from an attacker's origin,
 * which can cause the session cookie to be sent but cannot read anything back.
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Headers every state-changing request needs: content type plus CSRF proof. */
export function csrfHeaders(contentType = 'application/json'): Record<string, string> {
  const token = getCsrfToken();
  return {
    'Content-Type': contentType,
    ...(token ? { [CSRF_HEADER_NAME]: token } : {}),
  };
}
