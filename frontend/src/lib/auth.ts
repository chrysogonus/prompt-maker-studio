/**
 * Authentication utilities
 */

import { ChangePasswordRequest, ForgotPasswordRequest, LLMConnection, LLMConnectionTestResult, LLMConnectionUpdate, LLMModelPriceInfo, LoginRequest, RegisterRequest, ResetPasswordRequest, TokenResponse, User, UserUpdate } from '@/types/auth';
import { clearUserContentKeys, migrateLegacyStorageKeys, storageKey } from '@/lib/branding';
import { API_URL } from './apiBase';

// Runs at import time, not in an effect: the app layout reads the stored
// session expiry during render, which is already too late to rescue a
// pre-rename session.
migrateLegacyStorageKeys();

const SESSION_EXPIRY_KEY = storageKey('session-expiry');
const CLIENT_SESSION_EXPIRY_KEY = storageKey('client-session-expiry');
export const SESSION_EXPIRED_EVENT = storageKey('session-expired');

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

/**
 * Normalize a FastAPI error detail into a user-readable string.
 * FastAPI returns `detail` as a plain string for HTTP errors but as an array
 * of Pydantic validation objects for 422 Unprocessable Entity responses.
 */
function extractErrorMessage(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    // Pydantic v2 format: [{ loc: [...], msg: '...', type: '...' }]
    return detail.map((e) => (typeof e?.msg === 'string' ? e.msg : String(e))).join('; ');
  }
  return '';
}

export class AuthService {
  private static cachedUserPromise: Promise<User> | null = null;
  private static refreshPromise: Promise<void> | null = null;

  /**
   * Register a new user
   */
  static async register(data: RegisterRequest): Promise<User> {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: CREDENTIALS,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(extractErrorMessage(errorData.detail) || `Registration failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Log in. The token comes back as an httpOnly cookie the browser stores for
   * us; the body carries only when the session expires.
   */
  static async login(data: LoginRequest): Promise<TokenResponse> {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: CREDENTIALS,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(extractErrorMessage(errorData.detail) || `Login failed: ${response.status}`);
    }

    const tokenData = (await response.json()) as TokenResponse;
    this.recordSessionExpiry(tokenData.expires_at);
    return tokenData;
  }

  /**
   * Get current user info.
   *
   * This is also the authoritative "am I signed in?" check: the session cookie
   * is httpOnly, so the client cannot inspect it and has to ask the server.
   */
  static async getCurrentUser(): Promise<User> {
    if (!this.cachedUserPromise) {
      this.cachedUserPromise = (async () => {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: CREDENTIALS,
        });

        if (!response.ok) {
          if (response.status === 401) {
            this.removeToken();
            throw new Error('Session expired. Please login again.');
          }
          this.cachedUserPromise = null; // Clear on error so next call retries
          throw new Error('Failed to get user info');
        }

        return response.json();
      })();
    }

    return this.cachedUserPromise;
  }

  /**
   * Renew the session while it is still valid. Concurrent callers share one
   * request so route transitions cannot create a refresh stampede.
   */
  static async refreshSession(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: csrfHeaders(),
        credentials: CREDENTIALS,
      });
      if (!response.ok) {
        if (response.status === 401) this.removeToken();
        throw new Error('Session could not be refreshed. Please login again.');
      }
      const tokenData = (await response.json()) as TokenResponse;
      this.recordSessionExpiry(tokenData.expires_at);
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /** Refresh only when the session would expire during an upcoming operation. */
  static async ensureSessionValidity(minimumValidityMs: number): Promise<void> {
    const expiresAt = this.getTokenExpiryMs();
    if (expiresAt !== null && expiresAt - Date.now() <= minimumValidityMs) {
      await this.refreshSession();
    }
  }

  /**
   * Logout user.
   *
   * Unlike `removeToken` (an involuntary expiry, which promises the user their
   * unsaved work survives), signing out is deliberate and must leave nothing of
   * this account readable to the next person using the browser profile.
   *
   * The server call clears the httpOnly cookies, which the client cannot delete
   * itself. Local state is cleared regardless of whether it succeeds — a failed
   * request must never leave the user apparently still signed in.
   */
  static logout(): void {
    this.cachedUserPromise = null;
    this.refreshPromise = null;
    if (typeof window === 'undefined') return;
    void fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: csrfHeaders(),
      credentials: CREDENTIALS,
    }).catch(() => {});
    localStorage.removeItem(CLIENT_SESSION_EXPIRY_KEY);
    sessionStorage.removeItem(SESSION_EXPIRY_KEY);
    clearUserContentKeys();
  }

  /**
   * Sign out of every device, not just this browser.
   *
   * `logout` only clears cookies here; a session copied to another machine
   * keeps working until it expires. This invalidates them all server-side.
   * Awaited rather than fire-and-forget, because the caller needs to know
   * whether the revocation actually landed before it reports success.
   */
  static async logoutEverywhere(): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/logout-all`, {
      method: 'POST',
      headers: csrfHeaders(),
      credentials: CREDENTIALS,
    });
    if (!response.ok) {
      throw new Error('Could not sign out your other sessions. Please try again.');
    }
    this.logout();
  }

  /**
   * Whether a session is plausibly still open.
   *
   * A hint, not proof: the token itself is unreadable, so this only reports
   * whether the last known expiry is still in the future. `getCurrentUser` is
   * what actually settles it.
   */
  static isAuthenticated(): boolean {
    const expiresAt = this.getTokenExpiryMs();
    return expiresAt !== null && expiresAt > Date.now();
  }

  static getTokenExpiryMs(): number | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(CLIENT_SESSION_EXPIRY_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return isNaN(parsed) ? null : parsed;
  }

  /** Remember when the server said this session ends, for the expiry warning. */
  private static recordSessionExpiry(expiresAt: string | undefined): void {
    this.cachedUserPromise = null;
    if (typeof window === 'undefined') return;
    const parsed = expiresAt ? Date.parse(expiresAt) : NaN;
    if (isNaN(parsed)) {
      localStorage.removeItem(CLIENT_SESSION_EXPIRY_KEY);
      return;
    }
    localStorage.setItem(CLIENT_SESSION_EXPIRY_KEY, String(parsed));
  }

  /**
   * Drop the session after an involuntary expiry.
   *
   * The cookie itself is httpOnly and already rejected by the server; clearing
   * the local expiry is what flips the UI back to the sign-in screen.
   */
  static removeToken(): void {
    this.cachedUserPromise = null;
    this.refreshPromise = null;
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(
      SESSION_EXPIRY_KEY,
      JSON.stringify({
        reason: 'You were signed out due to inactivity. Your unsaved work is still available.',
        returnTo: `${window.location.pathname}${window.location.search}`,
      }),
    );
    localStorage.removeItem(CLIENT_SESSION_EXPIRY_KEY);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  static getSessionExpiry(): { reason: string; returnTo: string } | null {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_EXPIRY_KEY) ?? 'null');
    } catch {
      sessionStorage.removeItem(SESSION_EXPIRY_KEY);
      return null;
    }
  }

  static clearSessionExpiry(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(SESSION_EXPIRY_KEY);
  }

  /**
   * Update the authenticated user's profile (e.g. set/change email address).
   */
  static async updateProfile(data: UserUpdate): Promise<User> {
    this.cachedUserPromise = null;
    const response = await fetch(`${API_URL}/api/auth/me`, {
      method: 'PATCH',
      headers: csrfHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Update failed' }));
      throw new Error(extractErrorMessage(errorData.detail) || `Update failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Read the authenticated user's bring-your-own LLM provider connection,
   * plus the catalogue of selectable providers. Never includes the API key.
   */
  static async getLLMConnection(): Promise<LLMConnection> {
    return this.llmConnectionRequest('GET');
  }

  /**
   * Create or replace the provider connection. Omit `api_key` to keep the
   * stored one; pass an empty string to clear it.
   */
  static async updateLLMConnection(data: LLMConnectionUpdate): Promise<LLMConnection> {
    return this.llmConnectionRequest('PUT', data);
  }

  /** Disconnect the provider and erase the stored key. */
  static async deleteLLMConnection(): Promise<LLMConnection> {
    return this.llmConnectionRequest('DELETE');
  }

  /**
   * Send a tiny probe to the configured provider so a wrong key, endpoint, or
   * model name surfaces here rather than inside a feature. Always resolves —
   * failures come back as `{ ok: false, message }`.
   */
  static async testLLMConnection(): Promise<LLMConnectionTestResult> {
    return this.llmConnectionRequest('POST', undefined, '/test');
  }

  /** List models the configured provider exposes, with estimated token prices. */
  static async getLLMModels(): Promise<LLMModelPriceInfo[]> {
    return this.llmConnectionRequest('GET', undefined, '/models');
  }

  private static async llmConnectionRequest<T>(
    method: string,
    body?: unknown,
    suffix = '',
  ): Promise<T> {
    const response = await fetch(`${API_URL}/api/auth/me/llm-connection${suffix}`, {
      method,
      headers: csrfHeaders(),
      credentials: CREDENTIALS,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ detail: 'Failed to update the AI provider connection' }));
      throw new Error(
        extractErrorMessage(errorData.detail) || `Request failed: ${response.status}`,
      );
    }

    return response.json();
  }

  /**
   * Request a password-reset email for the given address.
   * Always resolves successfully — the server never reveals whether the email exists.
   */
  static async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    await fetch(`${API_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    // Intentionally ignoring response status — the server always returns 200
    // to avoid leaking whether an account with that email exists.
  }

  /**
   * Complete a password reset using the token from the reset email.
   */
  static async resetPassword(data: ResetPasswordRequest): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Reset failed' }));
      throw new Error(
        extractErrorMessage(errorData.detail) || `Password reset failed: ${response.status}`,
      );
    }
  }

  /**
   * Change the authenticated user's password (verifies current_password server-side).
   * Does not invalidate the current token — no re-login needed afterward.
   */
  static async changePassword(data: ChangePasswordRequest): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: csrfHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Password change failed' }));
      throw new Error(
        extractErrorMessage(errorData.detail) || `Password change failed: ${response.status}`,
      );
    }
  }
}
