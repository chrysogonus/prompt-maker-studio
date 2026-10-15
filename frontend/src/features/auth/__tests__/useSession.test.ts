import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook, waitFor } from '@testing-library/react';

import { AuthService } from '@/lib/auth';
import { useSession } from '../useSession';

const FIVE_MINUTES = 5 * 60 * 1000;

beforeEach(() => {
  vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
  vi.spyOn(AuthService, 'getTokenExpiryMs').mockReturnValue(Date.now() + 30 * 60 * 1000);
  vi.spyOn(AuthService, 'getCurrentUser').mockResolvedValue({ username: 'alex' } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSession activity renewal', () => {
  it('renews on user input, at most once per interval', async () => {
    const refresh = vi.spyOn(AuthService, 'refreshSession').mockResolvedValue();
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    // The first input renews at once: a reloaded page may be close to expiry.
    fireEvent.keyDown(window);
    fireEvent.pointerDown(window);
    expect(refresh).toHaveBeenCalledTimes(1);

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + FIVE_MINUTES);
    fireEvent.pointerDown(window);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not renew while signed out', async () => {
    vi.mocked(AuthService.isAuthenticated).mockReturnValue(false);
    const refresh = vi.spyOn(AuthService, 'refreshSession').mockResolvedValue();
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.isCheckingAuth).toBe(false));

    fireEvent.keyDown(window);

    expect(refresh).not.toHaveBeenCalled();
  });
});
