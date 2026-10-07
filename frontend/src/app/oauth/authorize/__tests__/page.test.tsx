/**
 * Tests for the OAuth consent page that MCP clients (ChatGPT) send users to.
 *
 * The final `window.location.assign` to the client is not asserted: jsdom
 * cannot navigate across origins, so these tests check what the page sends to
 * the backend and which screen it shows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthorizePage from '@/app/oauth/authorize/page';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';

let currentParams = new URLSearchParams('request=signed-request');

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}));

vi.mock('@/lib/api', () => ({
  ApiClient: {
    getOAuthConsent: vi.fn(),
    decideOAuthConsent: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  AuthService: {
    isAuthenticated: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

vi.mock('@/components/AuthForm', () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Mock sign in
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams('request=signed-request');
  vi.mocked(AuthService.isAuthenticated).mockReturnValue(true);
  vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
    id: 1,
    username: 'alice',
    email: 'alice@example.com',
    created_at: '2026-01-01T00:00:00Z',
  } as Awaited<ReturnType<typeof AuthService.getCurrentUser>>);
  vi.mocked(ApiClient.getOAuthConsent).mockResolvedValue({
    client_name: 'ChatGPT',
    redirect_host: 'chatgpt.com',
  });
  vi.mocked(ApiClient.decideOAuthConsent).mockResolvedValue({
    redirect_url: 'https://chatgpt.com/connector/oauth/cb?code=abc&state=s',
  });
});

describe('OAuth consent page', () => {
  it('names the client, the signed-in account, and where approval returns to', async () => {
    render(<AuthorizePage />);

    expect(await screen.findByRole('heading', { name: 'Connect ChatGPT?' })).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('chatgpt.com')).toBeInTheDocument();
    expect(ApiClient.getOAuthConsent).toHaveBeenCalledWith('signed-request');
  });

  it('sends approval for the request in the URL', async () => {
    render(<AuthorizePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));

    expect(ApiClient.decideOAuthConsent).toHaveBeenCalledWith('signed-request', true);
    expect(await screen.findByRole('status')).toHaveTextContent('Returning you to the app');
  });

  it('sends a denial', async () => {
    render(<AuthorizePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

    expect(ApiClient.decideOAuthConsent).toHaveBeenCalledWith('signed-request', false);
  });

  it('asks a signed-out user to sign in first, then shows consent', async () => {
    vi.mocked(AuthService.isAuthenticated).mockReturnValue(false);
    render(<AuthorizePage />);

    const signIn = await screen.findByRole('button', { name: 'Mock sign in' });
    expect(ApiClient.getOAuthConsent).not.toHaveBeenCalled();

    vi.mocked(AuthService.isAuthenticated).mockReturnValue(true);
    await userEvent.click(signIn);

    expect(await screen.findByRole('heading', { name: 'Connect ChatGPT?' })).toBeInTheDocument();
  });

  it('explains an expired or invalid request', async () => {
    vi.mocked(ApiClient.getOAuthConsent).mockRejectedValue(
      new Error('This connection request has expired or is invalid. Start again from the app.'),
    );
    render(<AuthorizePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('expired or is invalid');
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('rejects a link without a request', async () => {
    currentParams = new URLSearchParams('');
    render(<AuthorizePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('missing its connection request');
    await waitFor(() => expect(ApiClient.getOAuthConsent).not.toHaveBeenCalled());
  });

  it('shows a failed decision instead of leaving the user on a spinner', async () => {
    vi.mocked(ApiClient.decideOAuthConsent).mockRejectedValue(new Error('Server unavailable'));
    render(<AuthorizePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
  });
});
