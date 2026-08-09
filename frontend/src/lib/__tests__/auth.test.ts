import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth';

/**
 * Stand in for a login: the token itself now arrives as an httpOnly cookie the
 * test cannot see or set, so what a session looks like from the client's side
 * is exactly one thing — a recorded expiry.
 */
function sessionExpiringIn(seconds: number): void {
  localStorage.setItem(
    'prompt-maker-studio:client-session-expiry',
    String(Date.now() + seconds * 1000),
  );
}

function refreshResponse(seconds: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      token_type: 'bearer',
      expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
    }),
  } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);
  localStorage.clear();
  sessionStorage.clear();
  AuthService.logout();
  vi.restoreAllMocks();
});

describe('AuthService session refresh', () => {
  it('does not refresh a session with enough validity remaining', async () => {
    sessionExpiringIn(600);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await AuthService.ensureSessionValidity(120_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent refreshes for a near-expiry session', async () => {
    sessionExpiringIn(30);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshResponse(1_800));

    await Promise.all([
      AuthService.ensureSessionValidity(120_000),
      AuthService.ensureSessionValidity(120_000),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/refresh$/),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    // The new expiry came from the server's body, not from decoding a token.
    expect(AuthService.getTokenExpiryMs()).toBeGreaterThan(Date.now() + 1_700_000);
  });

  it('clears an expired session when refresh is rejected', async () => {
    sessionExpiringIn(5);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(AuthService.ensureSessionValidity(120_000)).rejects.toThrow(
      'Session could not be refreshed',
    );

    expect(AuthService.isAuthenticated()).toBe(false);
  });
});

describe('AuthService sign-out', () => {
  const drafts = {
    newPrompt: 'prompt-maker-studio:draft:alex',
    editor: 'prompt-maker-studio:editor-draft:alex:59',
    refine: 'prompt-maker-studio:refine:alex:41',
    legacyUnscoped: 'prompt-maker-studio:editor-draft:67',
  };

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);
    sessionExpiringIn(600);
    for (const key of Object.values(drafts)) localStorage.setItem(key, 'unsaved work');
    localStorage.setItem('theme', 'light');
  });

  it('erases every stored draft so the next person cannot read them', () => {
    AuthService.logout();

    for (const key of Object.values(drafts)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(AuthService.isAuthenticated()).toBe(false);
  });

  it('asks the server to clear the httpOnly cookies the client cannot delete', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    AuthService.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/logout$/),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('signs out locally even when the server call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    AuthService.logout();

    expect(AuthService.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(drafts.editor)).toBeNull();
  });

  it('leaves device preferences alone', () => {
    AuthService.logout();

    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('keeps drafts through an involuntary expiry, which promises they survive', () => {
    AuthService.removeToken();

    expect(localStorage.getItem(drafts.editor)).toBe('unsaved work');
    expect(localStorage.getItem(drafts.refine)).toBe('unsaved work');
  });
});

describe('AuthService LLM model catalogue', () => {
  it('requests the authenticated connection models endpoint', async () => {
    const models = [
      {
        id: 'gpt-4o-mini',
        input_price_per_1m: 0.15,
        output_price_per_1m: 0.6,
      },
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => models,
    } as Response);

    await expect(AuthService.getLLMModels()).resolves.toEqual(models);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/me\/llm-connection\/models$/),
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});
