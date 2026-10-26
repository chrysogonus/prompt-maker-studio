/**
 * Inline authenticated password-change control for the app header.
 * Mirrors the username-change interaction pattern in page.tsx: a toggle
 * button replaced by an inline form, collapsed again on cancel or success.
 */

'use client';

import { useState, FormEvent } from 'react';
import { AuthService } from '@/lib/auth';
import { PASSWORD_HINT, passwordPolicyError } from './passwordPolicy';
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
    // minLength bubble or letting the raw backend validation string reach the user.
    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    try {
      await AuthService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      // No logout needed — the server re-issues this browser's session.
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
      <div className={styles.closed}>
        <button className={styles.trigger} onClick={openForm} title="Click to change password">
          Change password
        </button>
        {success && <p className={styles.success} role="status">Password changed. Other devices were signed out.</p>}
      </div>
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
        placeholder={`New password (${PASSWORD_HINT})`}
        aria-label="New password"
        aria-invalid={!!error}
        minLength={10}
        maxLength={72}
        required
      />
      <button type="submit" className={styles.submit}>Save</button>
      <button type="button" className={styles.cancel} onClick={closeForm}>✕</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </form>
  );
}
