/** Same-origin session transport. Only explicit callers opt into renewal. */

import { AuthService } from '../auth';
import { CREDENTIALS, csrfHeaders } from '../authCookies';
import { ApiError } from './errors';

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";

export async function sessionFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const contentType = new Headers(init.headers).get('Content-Type') ?? 'application/json';
  try {
    return await fetch(url, { ...init, headers: csrfHeaders(contentType), credentials: CREDENTIALS });
  } catch (err) {
    // fetch rejects with a TypeError ("Failed to fetch") when offline; aborts stay as they are.
    if (err instanceof TypeError) throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
    throw err;
  }
}

export async function authenticatedFetch(
  url: string,
  init: RequestInit = {},
  minimumValidityMs = 0,
): Promise<Response> {
  if (minimumValidityMs > 0) {
    await AuthService.ensureSessionValidity(minimumValidityMs);
  }
  let response = await sessionFetch(url, init);
  if (response.status !== 401) return response;
  try {
    await AuthService.refreshSession();
  } catch {
    return response;
  }
  // Rebuild headers for the single retry: the cookies may have changed meanwhile.
  response = await sessionFetch(url, init);
  return response;
}
