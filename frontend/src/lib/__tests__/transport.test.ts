import { beforeEach, expect, it, vi } from 'vitest';
import { AuthService } from '../auth';
import { authenticatedFetch, sessionFetch } from '../api/transport';

beforeEach(() => vi.restoreAllMocks());

it('returns the original unauthorized response if session renewal fails', async () => {
  const response = { status: 401 } as Response;
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  vi.spyOn(AuthService, 'refreshSession').mockRejectedValue(new Error('Expired'));
  await expect(authenticatedFetch('/api/prompts')).resolves.toBe(response);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('retries an unauthorized request only once', async () => {
  const response = { status: 401 } as Response;
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  const refresh = vi.spyOn(AuthService, 'refreshSession').mockResolvedValue();
  await expect(authenticatedFetch('/api/prompts')).resolves.toBe(response);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('does not retry network failures or conflicts', async () => {
  const refresh = vi.spyOn(AuthService, 'refreshSession');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Offline'));
  await expect(authenticatedFetch('/api/prompts')).rejects.toThrow('Offline');
  const conflict = { status: 409 } as Response;
  fetch.mockResolvedValueOnce(conflict);
  await expect(authenticatedFetch('/api/prompts')).resolves.toBe(conflict);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(refresh).not.toHaveBeenCalled();
});

it('keeps callers without renewal opted out even on unauthorized responses', async () => {
  const response = { status: 401 } as Response;
  const refresh = vi.spyOn(AuthService, 'refreshSession');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  await expect(sessionFetch('/api/auth/change-password')).resolves.toBe(response);
  expect(refresh).not.toHaveBeenCalled();
});
