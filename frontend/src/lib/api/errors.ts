export interface BudgetErrorDetails {
  scope: 'shared' | 'user';
  resets_at: string;
  retry_after: number;
  reason: 'exhausted' | 'estimated_cost_exceeds_remaining';
}

export function extractBudgetDetails(value: unknown): BudgetErrorDetails | undefined {
  if (!value || typeof value !== 'object') return;
  const budget = value as Partial<BudgetErrorDetails>;
  if ((budget.scope === 'shared' || budget.scope === 'user')
    && typeof budget.resets_at === 'string' && Number.isFinite(Date.parse(budget.resets_at))
    && typeof budget.retry_after === 'number' && Number.isFinite(budget.retry_after) && budget.retry_after >= 0
    && (budget.reason === 'exhausted' || budget.reason === 'estimated_cost_exceeds_remaining')) {
    return budget as BudgetErrorDetails;
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly budget?: BudgetErrorDetails) {
    super(message);
    this.name = 'ApiError';
  }
}

/** FastAPI HTTP errors use strings; validation errors use objects with `msg`. */
export function extractErrorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(extractErrorMessage).filter(Boolean).join('; ');
  if (detail && typeof detail === 'object' && 'msg' in detail && typeof detail.msg === 'string') return detail.msg;
  return '';
}

export const PROMPT_NOT_FOUND_MESSAGE = 'Prompt not found — it may have been deleted.';

export function isValidPromptId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}
