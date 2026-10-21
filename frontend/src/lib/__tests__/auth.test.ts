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

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);
  localStorage.clear();
  sessionStorage.clear();
  await AuthService.logout();
  vi.restoreAllMocks();
});

describe('AuthService session refresh', () => {
  it.each(['network', 'json'])('retries the current-user request after a %s rejection while deduplicating callers', async (failure) => {
    const user = { username: 'alex' };
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('Offline'));
    else fetchMock.mockResolvedValueOnce(new Response('Invalid JSON'));
    fetchMock.mockResolvedValue({ ok: true, json: async () => user } as Response);

    const failed = await Promise.allSettled([AuthService.getCurrentUser(), AuthService.getCurrentUser()]);
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(Promise.all([AuthService.getCurrentUser(), AuthService.getCurrentUser()])).resolves.toEqual([user, user]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

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

  it('records the re-issued session expiry after a password change', async () => {
    sessionExpiringIn(60);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshResponse(1_800));

    await AuthService.changePassword({ current_password: 'old', new_password: 'newpass456!' });

    // Otherwise the UI would sign the user out at the old deadline.
    expect(AuthService.getTokenExpiryMs()).toBeGreaterThan(Date.now() + 1_700_000);
  });
});

describe('AuthService sign-out', () => {
  const drafts = {
    newPrompt: 'prompt-maker-studio:draft:alex',
    editor: 'prompt-maker-studio:editor-draft:alex:59',
    refine: 'prompt-maker-studio:refine:alex:41',
    evalSuggestions: 'prompt-maker-studio:eval-suggestions:alex:41',
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

  it.each(['success', 'network', 'json'])('clears cookies after a pending refresh finishes with %s without restoring the session', async (outcome) => {
    const order: string[] = [];
    let logoutHeaders: HeadersInit | undefined;
    let completeRefresh!: (response: Response) => void;
    let rejectRefresh!: (error: Error) => void;
    const pending = new Promise<Response>((resolve, reject) => {
      completeRefresh = resolve;
      rejectRefresh = reject;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => {
        try {
          return await pending;
        } finally {
          document.cookie = 'csrf_token=renewed-csrf';
          order.push('refresh');
        }
      })
      .mockImplementationOnce(async (_url, init) => {
        order.push('logout');
        logoutHeaders = init?.headers;
        return { ok: true, status: 204 } as Response;
      });

    const refresh = AuthService.refreshSession().catch(() => {});
    const logout = AuthService.logout();
    expect(AuthService.isAuthenticated()).toBe(false);
    if (outcome === 'network') rejectRefresh(new Error('Offline'));
    else if (outcome === 'json') completeRefresh(new Response('Invalid JSON'));
    else completeRefresh(refreshResponse(1_800));
    await Promise.all([refresh, logout]);

    expect(AuthService.isAuthenticated()).toBe(false);
    expect(order).toEqual(['refresh', 'logout']);
    expect(logoutHeaders).toEqual(expect.objectContaining({ 'X-CSRF-Token': 'renewed-csrf' }));
  });

  it('prevents further refreshes while sign-out is pending', async () => {
    let completeLogout!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => {
      completeLogout = resolve;
    })).mockResolvedValue(refreshResponse(1_800));

    const logout = AuthService.logout();
    await AuthService.refreshSession().catch(() => {});
    completeLogout({ ok: true, status: 204 } as Response);
    await logout;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(AuthService.isAuthenticated()).toBe(false);
  });

  it('finishes clearing old cookies before a new login', async () => {
    const order: string[] = [];
    let completeLogout!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => {
        const response = await new Promise<Response>((resolve) => { completeLogout = resolve; });
        order.push('logout');
        return response;
      })
      .mockImplementationOnce(async () => {
        order.push('login');
        return refreshResponse(1_800);
      });

    const logout = AuthService.logout();
    const login = AuthService.login({ username: 'alex', password: 'testpass123!' });
    completeLogout({ ok: true, status: 204 } as Response);
    await Promise.all([logout, login]);

    expect(order).toEqual(['logout', 'login']);
    expect(AuthService.isAuthenticated()).toBe(true);
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
