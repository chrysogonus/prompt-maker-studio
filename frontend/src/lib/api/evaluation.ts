import type { EvalCase, EvalCaseInput, EvalProposal, EvalRun } from '@/types/evaluation';
import type { PromptField } from '@/types/prompt';
import { API_URL } from '../apiBase';
import { ApiError, extractBudgetDetails, extractErrorMessage } from './errors';
import { authenticatedFetch } from './transport';

async function request(promptId: number, path: string, init: RequestInit = {}, billed = false) {
  const response = await authenticatedFetch(
    `${API_URL}/api/prompts/${promptId}/eval/${path}`, init, billed ? 2 * 60 * 1000 : 0,
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = extractErrorMessage(error?.detail) || 'Evaluation request failed. Please try again.';
    throw new ApiError(message, response.status, extractBudgetDetails(error?.budget));
  }
  return response;
}

export async function getEvalCases(promptId: number): Promise<EvalCase[]> {
  return (await request(promptId, 'cases')).json();
}

export async function createEvalCase(promptId: number, data: EvalCaseInput): Promise<EvalCase> {
  return (await request(promptId, 'cases', { method: 'POST', body: JSON.stringify(data) })).json();
}

export async function updateEvalCase(promptId: number, caseId: number, data: EvalCaseInput): Promise<EvalCase> {
  return (await request(promptId, `cases/${caseId}`, { method: 'PATCH', body: JSON.stringify(data) })).json();
}

export async function deleteEvalCase(promptId: number, caseId: number): Promise<void> {
  await request(promptId, `cases/${caseId}`, { method: 'DELETE' });
}

export async function importEvalCases(promptId: number, csv: string): Promise<EvalCase[]> {
  return (await request(promptId, 'cases/import', {
    method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv,
  })).json();
}

export async function exportEvalCases(promptId: number): Promise<Blob> {
  return (await request(promptId, 'cases/export')).blob();
}

export async function generateEvalCases(promptId: number, goal: string): Promise<{ proposals: EvalProposal[] }> {
  return (await request(promptId, 'cases/generate', {
    method: 'POST', body: JSON.stringify({ goal: goal.trim() || null }),
  }, true)).json();
}

/** `fields` tests unsaved sections instead of the saved prompt; they are never saved. */
export async function runEvaluation(promptId: number, fields?: PromptField[]): Promise<EvalRun> {
  const body = fields && JSON.stringify({ fields: fields.map(({ name, content }) => ({ name, content })) });
  return (await request(promptId, 'runs', { method: 'POST', body }, true)).json();
}

export async function getEvalRuns(promptId: number, limit = 50, offset = 0): Promise<EvalRun[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return (await request(promptId, `runs?${query}`)).json();
}

export async function rateEvalResult(promptId: number, runId: number, resultId: number, stars: number): Promise<EvalRun> {
  return (await request(promptId, `runs/${runId}/results/${resultId}/rate`, {
    method: 'POST', body: JSON.stringify({ stars }),
  })).json();
}
