/**
 * API client for interacting with the backend
 */

import { PromptRequest, PromptResponse, PromptHistoryResponse, ParseTextRequest, ParseTextResponse, PromptUpdateRequest, PromptsConfigResponse, PromptVersionResponse, PlaygroundRunRequest, PlaygroundRunResponse, PlaygroundRunHistoryResponse, EvalCase, EvalCaseCreateRequest, EvalCaseUpdateRequest, EvalCaseGenerateRequest, EvalCaseGenerateResponse, EvalRun, EvalRunRateRequest, RefineDraftRequest, RefineDraftResponse, RefineQuestionsResponse } from '@/types/prompt';
import { DashboardStatsResponse } from '@/types/analytics';
import { API_URL } from './apiBase';
import { AuthService, CREDENTIALS, csrfHeaders } from './auth';

const LONG_OPERATION_SESSION_VALIDITY_MS = 2 * 60 * 1000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Message shown for a prompt that does not exist. Matched on by the editor and
 * playground load-error screens to tell "gone" apart from "request failed". */
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

  private static getCsvAuthHeaders(): HeadersInit {
    return csrfHeaders('text/csv');
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
   * Generate a new prompt
   */
  static async generatePrompt(data: PromptRequest): Promise<PromptResponse> {
    const response = await fetch(`${API_URL}/api/prompts/generate`, {
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
      throw new Error(errorData.detail || `Failed to generate prompt: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get all named (saved) prompts for the current user, optionally filtered
   * by tag, folder, or favorite status for the Library screen.
   */
  static async getSavedPrompts(filters?: {
    tag?: string;
    folder?: string;
    favoriteOnly?: boolean;
  }): Promise<PromptHistoryResponse[]> {
    const params = new URLSearchParams();
    if (filters?.tag) params.set('tag', filters.tag);
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

  /**
   * Get the distinct tag labels used across the current user's prompts.
   */
  static async getTags(): Promise<string[]> {
    const response = await fetch(`${API_URL}/api/prompts/tags`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch tags');
    }

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
   * Get prompt history, optionally paginated with offset and filtered with search
   */
  static async getHistory(limit: number = 50, offset: number = 0, search?: string): Promise<PromptHistoryResponse[]> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search && search.trim()) {
      params.set('search', search.trim());
    }
    const response = await fetch(`${API_URL}/api/prompts/history?${params.toString()}`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch history');
    }

    return response.json();
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
   * Run a compiled prompt against a model in the Playground. Rate-limited
   * server-side (10/min) since this is a real, billed OpenAI request.
   */
  static async runPlayground(
    id: number,
    data: PlaygroundRunRequest
  ): Promise<PlaygroundRunResponse> {
    const response = await fetch(`${API_URL}/api/prompts/${id}/playground/run`, {
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
      throw new Error(errorData.detail || `Playground run failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get an owned prompt's prior Playground runs, newest first, for the
   * history drawer / replay feature. Includes failed attempts.
   */
  static async getPlaygroundRuns(
    id: number,
    limit: number = 20,
    offset: number = 0,
  ): Promise<PlaygroundRunHistoryResponse[]> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const response = await fetch(`${API_URL}/api/prompts/${id}/playground/runs?${params.toString()}`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch Playground run history');
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
   * Get the calling user's Dashboard usage analytics.
   */
  static async getDashboardStats(): Promise<DashboardStatsResponse> {
    const response = await fetch(`${API_URL}/api/analytics/dashboard`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch dashboard stats');
    }

    return response.json();
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

  /**
   * List an owned prompt's eval cases, in display order.
   */
  static async listEvalCases(promptId: number): Promise<EvalCase[]> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch eval cases');
    }

    return response.json();
  }

  /** Export an owned prompt's eval set as a CSV download. */
  static async exportEvalCases(promptId: number): Promise<Blob> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases/export`, {
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to export eval cases');
    }
    return response.blob();
  }

  /** Atomically append eval cases from UTF-8 CSV text. */
  static async importEvalCases(promptId: number, csvText: string): Promise<EvalCase[]> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases/import`, {
      method: 'POST',
      headers: this.getCsvAuthHeaders(),
      credentials: CREDENTIALS,
      body: csvText,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Failed to import eval cases: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Add a new eval case to an owned prompt.
   */
  static async createEvalCase(promptId: number, data: EvalCaseCreateRequest): Promise<EvalCase> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases`, {
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
      throw new Error(errorData.detail || `Failed to create eval case: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Propose a reviewable batch of eval cases from an owned prompt's current
   * template. Proposals are never persisted server-side — call createEvalCase
   * for each one the user accepts.
   */
  static async generateEvalCases(
    promptId: number,
    data: EvalCaseGenerateRequest,
  ): Promise<EvalCaseGenerateResponse> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases/generate`, {
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
      throw new Error(errorData.detail || `Failed to generate eval cases: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Partially update an owned eval case.
   */
  static async updateEvalCase(
    promptId: number,
    caseId: number,
    data: EvalCaseUpdateRequest,
  ): Promise<EvalCase> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases/${caseId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to update eval case');
    }

    return response.json();
  }

  /**
   * Delete an owned eval case.
   */
  static async deleteEvalCase(promptId: number, caseId: number): Promise<void> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/eval/cases/${caseId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to delete eval case');
    }
  }

  /**
   * Run every eval case attached to an owned prompt against a real model.
   * Rate-limited server-side (10/min) since this is a real, billed OpenAI request.
   */
  static async createEvalRun(promptId: number): Promise<EvalRun> {
    const response = await this.authenticatedFetch(`${API_URL}/api/prompts/${promptId}/eval/runs`, {
      method: 'POST',
    }, LONG_OPERATION_SESSION_VALIDITY_MS);

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Evaluation run failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * List an owned prompt's eval run history, newest first.
   */
  static async listEvalRuns(promptId: number): Promise<EvalRun[]> {
    const response = await this.authenticatedFetch(
      `${API_URL}/api/prompts/${promptId}/eval/runs`,
    );

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to fetch eval runs');
    }

    return response.json();
  }

  /**
   * Submit a 1-5 star manual rating for a pending eval result.
   */
  static async rateEvalResult(
    promptId: number,
    runId: number,
    resultId: number,
    data: EvalRunRateRequest,
  ): Promise<EvalRun> {
    const response = await fetch(
      `${API_URL}/api/prompts/${promptId}/eval/runs/${runId}/results/${resultId}/rate`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Failed to submit rating: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Generate clarifying questions about an owned prompt's current template.
   */
  static async getRefineQuestions(
    promptId: number,
    options: { force?: boolean } = {},
  ): Promise<RefineQuestionsResponse> {
    const params = new URLSearchParams();
    if (options.force) params.set('force', 'true');
    const query = params.toString();
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/refine/questions${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: CREDENTIALS,
    });

    if (!response.ok) {
      if (response.status === 401) {
        AuthService.removeToken();
        throw new Error('Session expired. Please login again.');
      }
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Failed to generate questions: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Generate a draft revision incorporating the given clarifying-question answers.
   */
  static async getRefineDraft(
    promptId: number,
    data: RefineDraftRequest,
  ): Promise<RefineDraftResponse> {
    const response = await fetch(`${API_URL}/api/prompts/${promptId}/refine/draft`, {
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
      throw new Error(errorData.detail || `Failed to generate a draft: ${response.status}`);
    }

    return response.json();
  }
}
