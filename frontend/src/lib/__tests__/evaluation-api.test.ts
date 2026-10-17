import { beforeEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../api';
import { AuthService } from '../auth';

beforeEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'csrf_token=first; path=/';
});

it('imports CSV with its media type and fresh CSRF proof after renewal', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response('[]'));
  vi.spyOn(AuthService, 'refreshSession').mockImplementation(async () => {
    document.cookie = 'csrf_token=renewed; path=/';
  });
  const csv = 'method,criteria,name\nrule,{json},Valid JSON';
  await expect(ApiClient.importEvalCases(7, csv)).resolves.toEqual([]);
  expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/prompts/7/eval/cases/import'),
    expect.objectContaining({
      method: 'POST', body: csv, credentials: 'include',
      headers: { 'Content-Type': 'text/csv', 'X-CSRF-Token': 'renewed' },
    }));
});

it('preserves a budget rejection without retrying the billed evaluation', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
    JSON.stringify({ detail: 'Your monthly API budget has been reached.' }), { status: 402 },
  ));
  vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue();
  await expect(ApiClient.runEvaluation(7)).rejects.toEqual(
    new ApiError('Your monthly API budget has been reached.', 402),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reports field validation errors in readable language', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
    JSON.stringify({ detail: [{ loc: ['body', 'name'], msg: 'String should have at most 100 characters' }] }),
    { status: 422 },
  ));
  await expect(ApiClient.createEvalCase(7, {
    method: 'manual', name: 'x'.repeat(101), criteria: '', variables: {}, intentionally_empty: false,
  })).rejects.toThrow('String should have at most 100 characters');
});

it('retains budget scope and reset information for recovery without repeating the run', async () => {
  const budget = { scope: 'user', resets_at: '2026-11-01T00:00:00+00:00', retry_after: 3600, reason: 'exhausted' };
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
    JSON.stringify({ detail: 'Your monthly API budget has been reached.', budget }), { status: 402 },
  ));
  vi.spyOn(AuthService, 'ensureSessionValidity').mockResolvedValue();
  await expect(ApiClient.runEvaluation(7)).rejects.toMatchObject({ status: 402, budget });
  expect(fetch).toHaveBeenCalledTimes(1);
});
