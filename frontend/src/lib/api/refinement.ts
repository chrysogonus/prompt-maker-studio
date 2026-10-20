import type { PromptField, RefineEvidence, RefineQAPair } from '@/types/prompt';
import { API_URL } from '../apiBase';
import { ApiError, extractBudgetDetails, extractErrorMessage } from './errors';
import { authenticatedFetch } from './transport';

async function refine<T>(step: 'questions' | 'draft', body: object): Promise<T> {
  const response = await authenticatedFetch(`${API_URL}/api/prompts/refine/${step}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, 2 * 60 * 1000);
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(
      extractErrorMessage(error?.detail) || 'Refinement failed. Please try again.',
      response.status,
      extractBudgetDetails(error?.budget),
    );
  }
  return response.json();
}

export function getRefinementQuestions(fields: PromptField[], force = false) {
  return refine<{ questions: string[] }>('questions', { fields, force });
}

export function createRefinementDraft(fields: PromptField[], qa_pairs: RefineQAPair[], evidence?: RefineEvidence) {
  return refine<{ fields: PromptField[] }>('draft', { fields, qa_pairs, evidence });
}
