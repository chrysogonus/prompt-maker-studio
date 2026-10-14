import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../api';
import { AuthService } from '../auth';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  AuthService.logout();
});

describe('refinement snapshots', () => {
  it.each([
    ['create', () => ApiClient.createPrompt({ name: 'Test', fields: [] })],
    ['update', () => ApiClient.updatePrompt(1, { fields: [] })],
    ['parse', () => ApiClient.parsePromptText({ text: 'Test' })],
    ['refine', () => ApiClient.getRefinementQuestions([])],
    ['evaluate', () => ApiClient.createEvalCase(1, { name: '', criteria: '', variables: {}, method: 'manual', intentionally_empty: true })],
    ['oauth', () => ApiClient.getOAuthConsent('request')],
  ])('normalizes FastAPI validation errors for %s and retains the status', async (_name, request) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 422,
      json: async () => ({ detail: [{ loc: ['body', 'fields', 0, 'content'], msg: 'String should have at most 10000 characters' }] }),
    } as Response);
    await expect(request()).rejects.toMatchObject({ message: 'String should have at most 10000 characters', status: 422 });
  });

  const fields = [{ name: 'Task', content: 'Explain {{topic}}' }];
  beforeEach(() => vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue());

  it('sends unsaved sections and force with CSRF protection', async () => {
    document.cookie = 'csrf_token=refine-csrf';
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ questions: ['Audience?'] }),
    } as Response);
    await expect(ApiClient.getRefinementQuestions(fields, true)).resolves.toEqual({ questions: ['Audience?'] });
    expect(fetch).toHaveBeenCalledWith('/api/prompts/refine/questions', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ fields, force: true }),
      headers: expect.objectContaining({ 'X-CSRF-Token': 'refine-csrf' }),
    }));
    expect(AuthService.ensureSessionValidity).toHaveBeenCalledWith(120000);
  });

  it('requests validated draft sections', async () => {
    const revised = [{ name: 'Task', content: 'Explain {{topic}} to beginners.' }];
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ fields: revised }) } as Response);
    const pairs = [{ question: 'Audience?', answer: 'Beginners' }];
    await expect(ApiClient.createRefinementDraft(fields, pairs)).resolves.toEqual({ fields: revised });
    expect(fetch).toHaveBeenCalledWith('/api/prompts/refine/draft', expect.objectContaining({ body: JSON.stringify({ fields, qa_pairs: pairs }) }));
  });

  it('preserves actionable provider errors without retrying billed requests', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 402, json: async () => ({ detail: 'Monthly budget reached' }) } as Response);
    await expect(ApiClient.getRefinementQuestions(fields)).rejects.toThrow('Monthly budget reached');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([async () => ({ detail: [] }), async () => { throw new Error('Not JSON'); }])('handles malformed error responses', async (json) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502, json } as Response);
    await expect(ApiClient.getRefinementQuestions(fields)).rejects.toThrow('Refinement failed. Please try again.');
  });
});

describe('ApiClient authenticated requests', () => {
  it('refreshes and retries a save once after a 401', async () => {
    // The session cookie is httpOnly and invisible here; what the client does
    // carry per request is the CSRF token, which a refresh rotates.
    document.cookie = 'csrf_token=original-csrf';
    vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue();
    const refreshSpy = vi.spyOn(AuthService, 'refreshSession').mockImplementation(async () => {
      document.cookie = 'csrf_token=refreshed-csrf';
    });
    const saved = { id: 7, name: 'Tutor' };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => saved,
      } as Response);

    await expect(
      ApiClient.createPrompt({ name: 'Tutor', fields: [{ name: 'Role', content: 'A tutor' }] }),
    ).resolves.toEqual(saved);

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

  it('shows the field-level validation message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ loc: ['body', 'name'], msg: 'Field required' }] }),
    } as Response);

    await expect(ApiClient.createPrompt(body)).rejects.toThrow('Field required');
  });
});

describe('account and OAuth request boundaries', () => {
  it('keeps wrong-password account deletion distinct from session expiry', async () => {
    const removeToken = vi.spyOn(AuthService, 'removeToken');
    const refresh = vi.spyOn(AuthService, 'refreshSession');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(ApiClient.deleteAccount('incorrect')).rejects.toThrow('Password is incorrect.');
    expect(removeToken).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends account deletion credentials and accepts an empty success response', async () => {
    document.cookie = 'csrf_token=account-csrf';
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);
    await expect(ApiClient.deleteAccount('password')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/auth\/me$/), expect.objectContaining({
      method: 'DELETE', credentials: 'include', body: JSON.stringify({ current_password: 'password' }),
      headers: expect.objectContaining({ 'X-CSRF-Token': 'account-csrf' }),
    }));
  });

  it('encodes consent handles and sends an explicit denial decision', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ client_name: 'Client' }),
    } as Response);
    await expect(ApiClient.getOAuthConsent('a+b&c')).resolves.toEqual({ client_name: 'Client' });
    expect(fetch.mock.calls[0][0]).toMatch(/request=a%2Bb%26c$/);
    await ApiClient.decideOAuthConsent('a+b&c', false);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({ request: 'a+b&c', approve: false });
  });

  it('clears expired consent sessions and preserves a typed unauthorized failure', async () => {
    const removeToken = vi.spyOn(AuthService, 'removeToken');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(ApiClient.getOAuthConsent('expired')).rejects.toMatchObject({ status: 401 });
    expect(removeToken).toHaveBeenCalledTimes(1);
  });

  it('uses the consent fallback when the server returns an unreadable error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new Error('Invalid JSON'); },
    } as unknown as Response);
    await expect(ApiClient.decideOAuthConsent('request', true)).rejects.toMatchObject({
      message: 'Could not complete the connection request.', status: 502,
    });
  });
});
