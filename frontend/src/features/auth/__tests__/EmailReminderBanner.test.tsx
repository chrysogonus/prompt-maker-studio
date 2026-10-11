import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmailReminderBanner from '../EmailReminderBanner';
import { AuthService } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  AuthService: {
    getCurrentUser: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(AuthService.getCurrentUser).mockReset();
});

describe('EmailReminderBanner', () => {
  it('renders when the current user has no email on file', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'legacyuser',
      email: null,
      created_at: '2026-01-01T00:00:00Z',
    } as Awaited<ReturnType<typeof AuthService.getCurrentUser>>);

    render(<EmailReminderBanner />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Add an email address to enable password recovery.'
    );
  });

  it('does not render when the current user already has an email', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 2,
      username: 'modernuser',
      email: 'modernuser@example.com',
      created_at: '2026-01-01T00:00:00Z',
    } as Awaited<ReturnType<typeof AuthService.getCurrentUser>>);

    render(<EmailReminderBanner />);

    await waitFor(() => expect(AuthService.getCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays dismissed for that user after clicking the dismiss control', async () => {
    const user = userEvent.setup();
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'legacyuser',
      email: null,
      created_at: '2026-01-01T00:00:00Z',
    } as Awaited<ReturnType<typeof AuthService.getCurrentUser>>);

    const { unmount } = render(<EmailReminderBanner />);
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    unmount();

    render(<EmailReminderBanner />);
    await waitFor(() => expect(AuthService.getCurrentUser).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
