/**
 * Inline authenticated password-change control for the app header.
 * Mirrors the username-change interaction pattern in page.tsx: a toggle
 * button replaced by an inline form, collapsed again on cancel or success.
 */

'use client';

import { useState, FormEvent } from 'react';
import { AuthService } from '@/lib/auth';
import styles from './ChangePasswordForm.module.css';

export default function ChangePasswordForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const openForm = () => {
    setIsOpen(true);
    setError('');
    setSuccess(false);
  };

  const closeForm = () => {
    setIsOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    // Pre-check with a friendly message rather than relying solely on the native
    // minLength bubble or letting the raw backend validation string ("String
    // should have at least 8 characters") reach the user.
    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    try {
      await AuthService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      // No logout needed — the JWT subject (username) is unaffected by a password change.
      setCurrentPassword('');
      setNewPassword('');
      setIsOpen(false);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    }
  };

  if (!isOpen) {
    return (
      <button className={styles.trigger} onClick={openForm} title="Click to change password">
        Change password
        {success && <span className={styles.successDot} aria-hidden="true" />}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      <input
        type="password"
        className={styles.input}
        value={currentPassword}
        onChange={e => setCurrentPassword(e.target.value)}
        placeholder="Current password"
        aria-label="Current password"
        aria-invalid={!!error}
        required
        autoFocus
      />
      <input
        type="password"
        className={styles.input}
        value={newPassword}
        onChange={e => setNewPassword(e.target.value)}
        placeholder="New password"
        aria-label="New password"
        aria-invalid={!!error}
        minLength={8}
        maxLength={72}
        required
      />
      <button type="submit" className={styles.submit}>Save</button>
      <button type="button" className={styles.cancel} onClick={closeForm}>✕</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </form>
  );
}
