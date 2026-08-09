/**
 * Tests for the AuthForm component.
 *
 * AuthForm covers three views: login, register, and forgot-password.
 * These tests exercise rendering and user interactions without making real
 * network calls — AuthService methods are mocked via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthForm from '@/components/AuthForm';
import { AuthService } from '@/lib/auth';

// Mock AuthService so no real HTTP calls are made
vi.mock('@/lib/auth', () => ({
  AuthService: {
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    getSessionExpiry: vi.fn(),
    clearSessionExpiry: vi.fn(),
  },
}));

const mockOnSuccess = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(AuthService.getSessionExpiry).mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// Login view (default)
// ---------------------------------------------------------------------------

describe('AuthForm — login view', () => {
  it('renders the login form by default', () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    expect(
      screen.getByRole('heading', { name: /turn rough ideas into prompts you can trust/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('keeps the prompt workspace preview decorative', () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    const preview = screen.getByText('Structured prompt', { exact: true });
    expect(preview.closest('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.getByText('<GOAL>')).toBeInTheDocument();
  });

  it('shows a "Forgot password?" link', () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    expect(screen.getByRole('button', { name: /forgot password/i })).toBeInTheDocument();
  });

  it('calls onSuccess after successful login', async () => {
    vi.mocked(AuthService.login).mockResolvedValueOnce({
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 1_800_000).toISOString(),
    });

    render(<AuthForm onSuccess={mockOnSuccess} />);

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'secret99');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(AuthService.login).toHaveBeenCalledWith({ username: 'alice', password: 'secret99' });
      expect(mockOnSuccess).toHaveBeenCalledOnce();
    });
  });

  it('shows an error message on failed login', async () => {
    vi.mocked(AuthService.login).mockRejectedValueOnce(new Error('Incorrect username or password'));

    render(<AuthForm onSuccess={mockOnSuccess} />);

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/incorrect username or password/i)).toBeInTheDocument();
    });
    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it('shows an announced inline error for whitespace-only credentials without calling the API', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);

    await userEvent.type(screen.getByLabelText(/username/i), '   ');
    await userEvent.type(screen.getByLabelText(/^password$/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your username.');
    expect(AuthService.login).not.toHaveBeenCalled();
  });

  it('shows an inline error when submitting the empty form instead of a native tooltip', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your username.');
    expect(AuthService.login).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from the username before logging in', async () => {
    vi.mocked(AuthService.login).mockResolvedValueOnce({
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 1_800_000).toISOString(),
    });

    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.type(screen.getByLabelText(/username/i), '  alice  ');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'secret99');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(AuthService.login).toHaveBeenCalledWith({ username: 'alice', password: 'secret99' });
    });
  });

  it('toggles password visibility via the Show/Hide button', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('explains an expired session and clears the notice after login', async () => {
    vi.mocked(AuthService.getSessionExpiry).mockReturnValue({
      reason: 'You were signed out due to inactivity. Your unsaved work is still available.',
      returnTo: '/editor/41',
    });
    vi.mocked(AuthService.login).mockResolvedValue({
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 1_800_000).toISOString(),
    });
    render(<AuthForm onSuccess={mockOnSuccess} />);

    expect(screen.getByRole('status')).toHaveTextContent('signed out due to inactivity');
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'secret99');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(AuthService.clearSessionExpiry).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// Register view
// ---------------------------------------------------------------------------

describe('AuthForm — register view', () => {
  it('switches to the register view when "Create account" is clicked', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
  });

  it('registers and auto-logs-in on success', async () => {
    vi.mocked(AuthService.register).mockResolvedValueOnce({
      id: 1, username: 'bob', created_at: '2026-01-01T00:00:00Z',
    });
    vi.mocked(AuthService.login).mockResolvedValueOnce({
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 1_800_000).toISOString(),
    });

    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await userEvent.type(screen.getByLabelText(/username/i), 'bob');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password99');
    await userEvent.type(screen.getByLabelText(/email address/i), 'bob@example.com');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(AuthService.register).toHaveBeenCalledWith({ username: 'bob', password: 'password99', email: 'bob@example.com' });
      expect(AuthService.login).toHaveBeenCalled();
      expect(mockOnSuccess).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Forgot-password view
// ---------------------------------------------------------------------------

describe('AuthForm — forgot-password view', () => {
  it('shows the forgot-password form when the link is clicked', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('submits the email and shows the confirmation message', async () => {
    vi.mocked(AuthService.forgotPassword).mockResolvedValueOnce(undefined);

    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    await userEvent.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(AuthService.forgotPassword).toHaveBeenCalledWith({ email: 'alice@example.com' });
      expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
    });
  });

  it('navigates back to the login view via "Back to sign in"', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    await userEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Validation reporting (shared across views)
// ---------------------------------------------------------------------------

describe('AuthForm — validation reporting', () => {
  it('reports every invalid register field in one pass, not one round trip each', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await userEvent.type(screen.getByLabelText(/username/i), 'ab');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'short');
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Username must be at least 3 characters.');
    expect(alert).toHaveTextContent('Password must be at least 8 characters.');
    expect(alert).toHaveTextContent('Enter a valid email address.');
    expect(AuthService.register).not.toHaveBeenCalled();
  });

  it('associates each validation message with the field it is about', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const username = await screen.findByLabelText(/username/i);
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveAccessibleDescription('Enter your username.');
    // Focus lands on the first offending field so a keyboard user is taken there.
    expect(username).toHaveFocus();
  });

  it('clears one field\'s error as it is corrected, leaving the others standing', async () => {
    render(<AuthForm onSuccess={mockOnSuccess} />);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByRole('alert');

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');

    expect(screen.getByLabelText(/username/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('aria-invalid', 'true');
  });
});
