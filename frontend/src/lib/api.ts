/**
 * API client for interacting with the backend
 */

import { PromptCreateRequest, PromptHistoryResponse, ParseTextRequest, ParseTextResponse, PromptUpdateRequest, PromptsConfigResponse, PromptVersionResponse } from '@/types/prompt';
import { OAuthConsentDetails, OAuthConsentResult } from '@/types/oauth';
import { API_URL } from './apiBase';
import { AuthService, CREDENTIALS, csrfHeaders } from './auth';

const LONG_OPERATION_SESSION_VALIDITY_MS = 2 * 60 * 1000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Message shown for a prompt that does not exist. Matched on by the editor's
 * load-error screen to tell "gone" apart from "request failed". */
export const PROMPT_NOT_FOUND_MESSAGE = 'Prompt not found — it may have been deleted.';

/**
 * Whether a route's `:id` segment parsed into a usable prompt id.
 *
 * `Number('some-uuid')` is `NaN`, which sailed straight into the request URL
 * and came back as an opaque server error, so a mistyped or stale link looked
 * like an outage instead of a missing prompt.
 */
export function isValidPromptId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

export class ApiClient {
  /**
   * Headers for an authenticated request.
   *
   * The session token is no longer sent here — it lives in an httpOnly cookie
   * the browser attaches itself, which is why every request below also sets
   * `credentials: CREDENTIALS`. What this adds is the CSRF token, which the
   * server requires on cookie-authenticated writes.
   */
  private static getAuthHeaders(): HeadersInit {
    return csrfHeaders();
  }

  /**
   * Send an authenticated request, renewing proactively for long operations
   * and retrying once when a still-valid session can be refreshed.
   */
  private static async authenticatedFetch(
    url: string,
    init: RequestInit = {},
    minimumValidityMs = 0,
  ): Promise<Response> {
    if (minimumValidityMs > 0) {
      await AuthService.ensureSessionValidity(minimumValidityMs);
    }

    // Headers are rebuilt per attempt: a refresh rotates the CSRF cookie, so
    // the retry below must pick up the new token rather than replay the old.
    const send = () =>
      fetch(url, { ...init, headers: this.getAuthHeaders(), credentials: CREDENTIALS });
    let response = await send();
    if (response.status !== 401) return response;

    try {
      await AuthService.refreshSession();
    } catch {
      return response;
    }
    response = await send();
    return response;
  }

  /**
   * Save a new prompt to the library. The server renders its text from the
   * sections, so only the sections are sent.
   */
  static async createPrompt(data: PromptCreateRequest): Promise<PromptHistoryResponse> {
    const response = await this.authenticatedFetch(`${API_URL}/api/prompts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const detail = Array.isArray(errorData.detail) ? null : errorData.detail;
      throw new ApiError(detail || `Failed to save prompt: ${response.status}`, response.status);
    }

    return response.json();
  }

  /**
   * Get all named (saved) prompts for the current user, optionally filtered
   * by folder or favorite status.
   */
  static async getSavedPrompts(filters?: {
    folder?: string;
    favoriteOnly?: boolean;
  }): Promise<PromptHistoryResponse[]> {
    const params = new URLSearchParams();
    if (filters?.folder) params.set('folder', filters.folder);
    if (filters?.favoriteOnly) params.set('favorite_only', 'true');
    const query = params.toString();

    const response = await fetch(`${API_URL}/api/prompts/saved${query ? `?${query}` : ''}`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch saved prompts');
    }

    return response.json();
  }

  /** Rename a folder; renaming onto an existing folder merges the two. */
  static async renameFolder(name: string, newName: string): Promise<{ name: string; prompt_count: number }> {
    const response = await this.authenticatedFetch(
      `${API_URL}/api/prompts/folders?${new URLSearchParams({ name })}`,
      { method: 'PATCH', body: JSON.stringify({ name: newName }) },
    );
    if (!response.ok) throw new ApiError('Failed to rename folder', response.status);
    return response.json();
  }

  /** Remove a folder. Its prompts become unfiled; none are deleted. */
  static async removeFolder(name: string): Promise<{ name: string; prompt_count: number }> {
    const response = await this.authenticatedFetch(
      `${API_URL}/api/prompts/folders?${new URLSearchParams({ name })}`,
      { method: 'DELETE' },
    );
    if (!response.ok) throw new ApiError('Failed to remove folder', response.status);
    return response.json();
  }

  /**
   * Get the distinct folder labels used across the current user's prompts.
   */
  static async getFolders(): Promise<string[]> {
    const response = await fetch(`${API_URL}/api/prompts/folders`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch folders');
    }

    return response.json();
  }

  /**
   * Update an existing prompt (name, fields, generated_prompt)
   */
  static async updatePrompt(id: number, patch: PromptUpdateRequest): Promise<PromptHistoryResponse> {
    const response = await fetch(`${API_URL}/api/prompts/${id}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      // ApiError (not a bare Error) so callers can distinguish a 409 edit
      // conflict from any other failure without matching on the message text.
      throw new ApiError(
        errorData.detail || `Failed to update prompt: ${response.status}`,
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Delete an existing prompt permanently
   */
  static async deletePrompt(id: number): Promise<void> {
    const response = await this.authenticatedFetch(`${API_URL}/api/prompts/${id}`, {
      method: 'DELETE',
    }, LONG_OPERATION_SESSION_VALIDITY_MS);

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error(`Failed to delete prompt: ${response.status}`);
    }
  }

  /**
   * Fire-and-forget delete for page teardown. `keepalive` lets the request
   * outlive the page, so an optimistic delete still pending its undo window
   * is not silently dropped when the user refreshes or closes the tab.
   */
  static flushDeletePrompt(id: number): void {
    void fetch(`${API_URL}/api/prompts/${id}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
      keepalive: true,
    }).catch(() => {});
  }

  /**
   * Get a specific prompt by ID
   */
  static async getPromptById(id: number): Promise<PromptHistoryResponse> {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/api/prompts/${id}`, {
        headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ApiError('The prompt request timed out. Please retry.', 408);
      }
      throw error;
    }

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      if (response.status === 404) {
        throw new ApiError(PROMPT_NOT_FOUND_MESSAGE, 404);
      }
      throw new ApiError(
        `The prompt could not be loaded (server error ${response.status}). Please retry.`,
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Parse natural language text into structured prompt fields
   */
  static async parsePromptText(data: ParseTextRequest): Promise<ParseTextResponse> {
    const response = await fetch(`${API_URL}/api/prompts/parse-text`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Failed to parse text: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get the calling user's AI capability state (whether they have a provider
   * connected, which model, and the global budget snapshot). Authenticated,
   * because provider credentials are per-user. Callers treat any failure as
   * "assume available" rather than blocking the feature, so no 401 handling
   * is layered on here.
   */
  static async getPromptsConfig(): Promise<PromptsConfigResponse> {
    const response = await fetch(`${API_URL}/api/prompts/config`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      throw new Error('Failed to fetch prompts config');
    }

    return response.json();
  }

  /**
   * Deep-copy an existing prompt, including authoring metadata and eval cases.
   */
  static async duplicatePrompt(id: number): Promise<PromptHistoryResponse> {
    const response = await fetch(`${API_URL}/api/prompts/${id}/duplicate`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to duplicate prompt');
    }

    return response.json();
  }

  /**
   * Get the version history of an owned prompt, newest first.
   */
  static async getPromptVersions(id: number): Promise<PromptVersionResponse[]> {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/api/prompts/${id}/versions`, {
        headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ApiError('The version-history request timed out. Please retry.', 408);
      }
      throw error;
    }

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch prompt versions');
    }

    return response.json();
  }

  /**
   * Describe a pending OAuth request from an MCP client (e.g. ChatGPT) for
   * the consent screen. `request` is the signed value /api/oauth/authorize
   * put in the page URL.
   */
  static async getOAuthConsent(request: string): Promise<OAuthConsentDetails> {
    const response = await fetch(
      `${API_URL}/api/oauth/consent?request=${encodeURIComponent(request)}`,
      { headers: this.getAuthHeaders(), credentials: CREDENTIALS },
    );
    return this.readOAuthConsentResponse(response);
  }

  /** Approve or deny a pending OAuth request; returns the client redirect. */
  static async decideOAuthConsent(request: string, approve: boolean): Promise<OAuthConsentResult> {
    const response = await fetch(`${API_URL}/api/oauth/consent`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify({ request, approve }),
    });
    return this.readOAuthConsentResponse(response);
  }

  private static async readOAuthConsentResponse<T>(response: Response): Promise<T> {
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

  /**
   * Restore a prompt to a prior version's fields/generated_prompt.
   */
  static async restorePromptVersion(id: number, versionId: number): Promise<PromptHistoryResponse> {
    const response = await fetch(`${API_URL}/api/prompts/${id}/versions/${versionId}/restore`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to restore prompt version');
    }

    return response.json();
  }

  /**
   * Export all of the calling user's prompts (with version history) as a
   * raw JSON blob, for the Settings "Export all prompts" download.
   */
  static async exportPrompts(): Promise<Blob> {
    const response = await fetch(`${API_URL}/api/prompts/export`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to export prompts');
    }

    return response.blob();
  }

  /**
   * Permanently delete the authenticated user's account and all associated data.
   * Caller must clear local auth state after this resolves.
   *
   * Requires the account password: this is irreversible, so a session that
   * happens to be open is not enough on its own.
   */
  static async deleteAccount(currentPassword: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify({ current_password: currentPassword }),
    });

    if (!response.ok) {
      // 401 here means a rejected password, not an expired session — signing the
      // user out at this point would lose the distinction and look like a bug.
      if (response.status === 401) {
        throw new Error('Password is incorrect.');
      }
      throw new Error(`Failed to delete account: ${response.status}`);
    }
  }

}
