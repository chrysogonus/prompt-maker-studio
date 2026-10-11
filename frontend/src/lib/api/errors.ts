export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export const PROMPT_NOT_FOUND_MESSAGE = 'Prompt not found — it may have been deleted.';

export function isValidPromptId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}
