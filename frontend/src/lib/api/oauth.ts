import { OAuthConsentDetails, OAuthConsentResult } from '@/types/oauth';
import { API_URL } from '../apiBase';
import { AuthService } from '../auth';
import { sessionFetch } from './transport';
import { ApiError } from './errors';

export async function getOAuthConsent(request: string): Promise<OAuthConsentDetails> {
  const response = await sessionFetch(
    `${API_URL}/api/oauth/consent?request=${encodeURIComponent(request)}`,
  );
  return readOAuthConsentResponse(response);
}

export async function decideOAuthConsent(request: string, approve: boolean): Promise<OAuthConsentResult> {
  const response = await sessionFetch(`${API_URL}/api/oauth/consent`, {
    method: 'POST',
    body: JSON.stringify({ request, approve }),
  });
  return readOAuthConsentResponse(response);
}

async function readOAuthConsentResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      AuthService.removeToken();
      throw new ApiError('Session expired. Please sign in again.', 401);
    }
    const errorData = await response.json().catch(() => ({ detail: '' }));
    throw new ApiError(
      typeof errorData.detail === 'string' && errorData.detail
        ? errorData.detail
        : 'Could not complete the connection request.',
      response.status,
    );
  }
  return response.json();
}
