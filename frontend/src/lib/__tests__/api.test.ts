import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../api';
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

describe('ApiClient.createPrompt', () => {
  const body = { name: 'Tutor', fields: [{ name: 'Role', content: 'A tutor' }], folder: 'Learning' };

  it('posts the sections, never any rendered text, and returns the saved prompt', async () => {
    const saved = { id: 5, ...body, generated_prompt: '<ROLE>\nA tutor\n</ROLE>' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => saved,
    } as Response);

    await expect(ApiClient.createPrompt(body)).resolves.toEqual(saved);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/prompts$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it('throws an ApiError carrying the server message and status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Budget exhausted' }),
    } as Response);

    const error = await ApiClient.createPrompt(body).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Budget exhausted', status: 409 });
  });

  it('falls back to a plain message for field-level validation errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ loc: ['body', 'name'], msg: 'Field required' }] }),
    } as Response);

    await expect(ApiClient.createPrompt(body)).rejects.toThrow('Failed to save prompt: 422');
  });
});
