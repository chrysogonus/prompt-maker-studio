import {
  PromptCreateRequest,
  PromptHistoryResponse,
  ParseTextRequest,
  ParseTextResponse,
  PromptUpdateRequest,
  PromptsConfigResponse,
  PromptVersionResponse,
  TryPromptResponse,
} from '@/types/prompt';

import { API_URL } from '../apiBase';
import { AuthService } from '../auth';
import { authenticatedFetch, sessionFetch } from './transport';
import { ApiError, PROMPT_NOT_FOUND_MESSAGE } from './errors';

const LONG_OPERATION_SESSION_VALIDITY_MS = 2 * 60 * 1000;

export async function createPrompt(data: PromptCreateRequest): Promise<PromptHistoryResponse> {
  const response = await authenticatedFetch(`${API_URL}/api/prompts`, {
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

export async function getSavedPrompts(filters?: {
  folder?: string;
  favoriteOnly?: boolean;
}): Promise<PromptHistoryResponse[]> {
  const params = new URLSearchParams();
  if (filters?.folder) params.set('folder', filters.folder);
  if (filters?.favoriteOnly) params.set('favorite_only', 'true');
  const query = params.toString();

  const response = await sessionFetch(`${API_URL}/api/prompts/saved${query ? `?${query}` : ''}`);

  if (!response.ok) {
    if (response.status === 401) {
      AuthService.removeToken();
      throw new Error('Session expired. Please login again.');
    }
    throw new Error('Failed to fetch saved prompts');
  }

  return response.json();
}

export async function renameFolder(name: string, newName: string): Promise<{ name: string; prompt_count: number }> {
  const response = await authenticatedFetch(
    `${API_URL}/api/prompts/folders?${new URLSearchParams({ name })}`,
    { method: 'PATCH', body: JSON.stringify({ name: newName }) },
  );
  if (!response.ok) throw new ApiError('Failed to rename folder', response.status);
  return response.json();
}

export async function removeFolder(name: string): Promise<{ name: string; prompt_count: number }> {
  const response = await authenticatedFetch(
    `${API_URL}/api/prompts/folders?${new URLSearchParams({ name })}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new ApiError('Failed to remove folder', response.status);
  return response.json();
}

export async function getFolders(): Promise<string[]> {
  const response = await sessionFetch(`${API_URL}/api/prompts/folders`);

  if (!response.ok) {
    if (response.status === 401) {
      AuthService.removeToken();
      throw new Error('Session expired. Please login again.');
    }
    throw new Error('Failed to fetch folders');
  }

  return response.json();
}

export async function updatePrompt(id: number, patch: PromptUpdateRequest): Promise<PromptHistoryResponse> {
  const response = await sessionFetch(`${API_URL}/api/prompts/${id}`, {
    method: 'PATCH',
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

export async function deletePrompt(id: number): Promise<void> {
  const response = await authenticatedFetch(`${API_URL}/api/prompts/${id}`, {
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

export function flushDeletePrompt(id: number): void {
  void sessionFetch(`${API_URL}/api/prompts/${id}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => {});
}

export async function getPromptById(id: number): Promise<PromptHistoryResponse> {
  let response: Response;
  try {
    response = await sessionFetch(`${API_URL}/api/prompts/${id}`, {
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

export async function parsePromptText(data: ParseTextRequest): Promise<ParseTextResponse> {
  const response = await sessionFetch(`${API_URL}/api/prompts/parse-text`, {
    method: 'POST',
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

export async function getPromptsConfig(): Promise<PromptsConfigResponse> {
  const response = await sessionFetch(`${API_URL}/api/prompts/config`);

  if (!response.ok) {
    throw new Error('Failed to fetch prompts config');
  }

  return response.json();
}

export async function duplicatePrompt(id: number): Promise<PromptHistoryResponse> {
  const response = await sessionFetch(`${API_URL}/api/prompts/${id}/duplicate`, {
    method: 'POST',
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

export async function getPromptVersions(id: number): Promise<PromptVersionResponse[]> {
  let response: Response;
  try {
    response = await sessionFetch(`${API_URL}/api/prompts/${id}/versions`, {
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

export async function restorePromptVersion(id: number, versionId: number): Promise<PromptHistoryResponse> {
  const response = await sessionFetch(`${API_URL}/api/prompts/${id}/versions/${versionId}/restore`, {
    method: 'POST',
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

export async function exportPrompts(): Promise<Blob> {
  const response = await sessionFetch(`${API_URL}/api/prompts/export`);

  if (!response.ok) {
    if (response.status === 401) {
      AuthService.removeToken();
      throw new Error('Session expired. Please login again.');
    }
    throw new Error('Failed to export prompts');
  }

  return response.blob();
}

export async function tryPrompt(text: string): Promise<TryPromptResponse> {
  const response = await authenticatedFetch(`${API_URL}/api/prompts/try`, {
    method: 'POST', body: JSON.stringify({ text }),
  }, LONG_OPERATION_SESSION_VALIDITY_MS);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(typeof error.detail === 'string' ? error.detail : 'Could not run the prompt. Try once accepts up to 100,000 characters.', response.status);
  }
  return response.json();
}
