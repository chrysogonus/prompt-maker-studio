import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api';
import { AuthService } from '../auth';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  AuthService.logout();
});

describe('ApiClient authenticated requests', () => {
  it('refreshes and retries an eval run once after a 401', async () => {
    // The session cookie is httpOnly and invisible here; what the client does
    // carry per request is the CSRF token, which a refresh rotates.
    document.cookie = 'csrf_token=original-csrf';
    vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue();
    const refreshSpy = vi.spyOn(AuthService, 'refreshSession').mockImplementation(async () => {
      document.cookie = 'csrf_token=refreshed-csrf';
    });
    const run = { id: 7, score: 100, results: [] };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => run,
      } as Response);

    await expect(ApiClient.createEvalRun(48)).resolves.toEqual(run);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Credentials ride on the cookie, never in a readable header.
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'original-csrf' }),
      }),
    );
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'refreshed-csrf' }),
      }),
    );
  });

  it('preflights a long eval run with a two-minute validity requirement', async () => {
    const validitySpy = vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 8, score: null, results: [] }),
    } as Response);

    await ApiClient.createEvalRun(48);

    expect(validitySpy).toHaveBeenCalledWith(120_000);
  });

  it('renews near-expiry auth before a delayed prompt deletion commits', async () => {
    const validitySpy = vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);

    await ApiClient.deletePrompt(49);

    expect(validitySpy).toHaveBeenCalledWith(120_000);
  });
});
