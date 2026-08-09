/**
 * Tests for the ChangePasswordForm component.
 *
 * AuthService is mocked via vi.mock so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePasswordForm from '../ChangePasswordForm';
import { AuthService } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  AuthService: {
    changePassword: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChangePasswordForm component', () => {
  it('renders a trigger button collapsed by default', () => {
    render(<ChangePasswordForm />);

    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });

  it('expands into a form when the trigger is clicked', async () => {
    render(<ChangePasswordForm />);

    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
  });

  it('calls AuthService.changePassword with both field values on submit', async () => {
    vi.mocked(AuthService.changePassword).mockResolvedValue(undefined);

    render(<ChangePasswordForm />);
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));

    await userEvent.type(screen.getByLabelText(/current password/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(AuthService.changePassword).toHaveBeenCalledWith({
        current_password: 'oldpass123',
        new_password: 'newpass456',
      });
    });
  });

  it('collapses the form and clears fields on success', async () => {
    vi.mocked(AuthService.changePassword).mockResolvedValue(undefined);

    render(<ChangePasswordForm />);
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/current password/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    });
  });

  it('shows an error message when the change is rejected and keeps the form open', async () => {
    vi.mocked(AuthService.changePassword).mockRejectedValue(
      new Error('Current password is incorrect')
    );

    render(<ChangePasswordForm />);
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/current password/i), 'wrongpass');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  it('shows a friendly inline length error when Save is clicked with a short password', async () => {
    render(<ChangePasswordForm />);
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/current password/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^new password$/i), '1');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(
      await screen.findByText('Your new password must be at least 8 characters.')
    ).toBeInTheDocument();
    expect(AuthService.changePassword).not.toHaveBeenCalled();
  });

  it('shows an inline error when the current password is missing', async () => {
    render(<ChangePasswordForm />);
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass456');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Enter your current password.')).toBeInTheDocument();
    expect(AuthService.changePassword).not.toHaveBeenCalled();
  });

  it('collapses without submitting when cancel is clicked', async () => {
    render(<ChangePasswordForm />);
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/current password/i), 'something');

    await userEvent.click(screen.getByRole('button', { name: '✕' }));

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(AuthService.changePassword).not.toHaveBeenCalled();
  });
});
