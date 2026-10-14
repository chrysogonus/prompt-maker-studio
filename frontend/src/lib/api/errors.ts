export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
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
