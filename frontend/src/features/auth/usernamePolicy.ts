/**
 * Rules for a newly chosen username, mirroring the backend's account schema so
 * users get a friendly message instead of the raw pattern from validation.
 */

export const USERNAME_HINT = '3–50 letters, numbers, underscores or hyphens; saved in lower case';

export function usernamePolicyError(username: string): string | null {
  if (/^[a-zA-Z0-9_-]{3,50}$/.test(username.trim())) return null;
  return 'Username must be 3-50 characters using only letters, digits, underscores, and hyphens.';
}
