/**
 * Rules for a newly chosen password, mirroring the backend's `NewPassword`
 * validator so users get a friendly message before a round trip. Sign-in
 * never applies them, so older passwords keep working.
 */

export const PASSWORD_HINT = '10+ characters, with a number and a symbol';

export function passwordPolicyError(password: string): string | null {
  // Count code points, as the backend does, not UTF-16 units.
  if ([...password].length < 10) return 'Password must be at least 10 characters.';
  if (!/\d/.test(password)) return 'Password must contain at least one number.';
  if (!/[^\p{L}\p{N}\s]/u.test(password)) {
    return 'Password must contain at least one special character, such as $ or #.';
  }
  return null;
}
