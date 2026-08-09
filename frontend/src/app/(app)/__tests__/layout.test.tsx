import { fireEvent, render, screen } from '@testing-library/react';
import { expectConsoleError } from '@/test/setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import AppLayout from '../layout';
import { AuthService } from '@/lib/auth';

vi.mock('@/components/AuthForm', () => ({
  default: () => <div>Auth form</div>,
}));

vi.mock('@/components/NavBar', () => ({
  default: () => <nav>Navigation</nav>,
}));

vi.mock('@/lib/auth', () => ({
  SESSION_EXPIRED_EVENT: 'prompt-maker-studio:session-expired',
  AuthService: {
    isAuthenticated: vi.fn(),
    getCurrentUser: vi.fn(),
    removeToken: vi.fn(),
    logout: vi.fn(),
    getTokenExpiryMs: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(AuthService.isAuthenticated).mockReturnValue(true);
  vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
    username: 'testuser',
  } as Awaited<ReturnType<typeof AuthService.getCurrentUser>>);
});

describe('AppLayout', () => {
  it('provides a skip link whose target is the main content landmark', async () => {
    render(
      <AppLayout>
        <p>Page content</p>
      </AppLayout>
    );

    const skipLink = await screen.findByRole('link', { name: 'Skip to main content' });
    expect(skipLink).toHaveAttribute('href', '#main-content');

    const main = document.querySelector(skipLink.getAttribute('href')!);
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveTextContent('Page content');
  });

  it('identifies the public Apache license in the application footer', async () => {
    render(
      <AppLayout>
        <p>Page content</p>
      </AppLayout>,
    );

    const licenseLink = await screen.findByRole('link', { name: 'Apache-2.0' });
    expect(licenseLink).toHaveAttribute(
      'href',
      'https://github.com/chrysogonus/prompt-maker-studio/blob/main/LICENSE',
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Licensed under Apache-2.0');
    expect(screen.getByRole('contentinfo')).not.toHaveTextContent('All rights reserved');
  });

  it('retains a persisted session and offers retry after a transient reload check failure', async () => {
    // This test injects the network failure the layout is expected to log.
    expectConsoleError('Auth check failed:');
    vi.mocked(AuthService.getCurrentUser)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ username: 'testuser' } as Awaited<
        ReturnType<typeof AuthService.getCurrentUser>
      >);
    render(
      <AppLayout>
        <p>Page content</p>
      </AppLayout>,
    );

    expect(await screen.findByText(/session is still saved/)).toBeInTheDocument();
    expect(AuthService.removeToken).not.toHaveBeenCalled();
    expect(screen.queryByText('Auth form')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry session check' }));

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('returns to the login gate when a bfcache-restored page no longer has a session', async () => {
    render(
      <AppLayout>
        <p>Account data</p>
      </AppLayout>,
    );
    expect(await screen.findByText('Account data')).toBeInTheDocument();

    // Simulate signing out elsewhere, then the browser restoring this page
    // from the back/forward cache (Back button after logout).
    vi.mocked(AuthService.isAuthenticated).mockReturnValue(false);
    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    fireEvent(window, pageShow);

    expect(await screen.findByText('Auth form')).toBeInTheDocument();
    expect(screen.queryByText('Account data')).not.toBeInTheDocument();
  });

  it('re-checks the session when the page regains visibility', async () => {
    render(
      <AppLayout>
        <p>Account data</p>
      </AppLayout>,
    );
    expect(await screen.findByText('Account data')).toBeInTheDocument();

    vi.mocked(AuthService.isAuthenticated).mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));

    expect(await screen.findByText('Auth form')).toBeInTheDocument();
  });
});
