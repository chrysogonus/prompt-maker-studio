import { API_URL } from '../apiBase';

import { sessionFetch } from './transport';

export async function deleteAccount(currentPassword: string): Promise<void> {
  const response = await sessionFetch(`${API_URL}/api/auth/me`, {
    method: 'DELETE',
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
