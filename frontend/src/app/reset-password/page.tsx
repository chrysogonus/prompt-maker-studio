/**
 * Password reset page — reached by clicking the link in the reset email.
 *
 * URL shape: /reset-password?token=<hex_token>
 *
 * Validates the token server-side on submit; on success the user is shown a
 * confirmation message and a link back to the login page.
 */

'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthService } from '@/lib/auth';
import styles from './page.module.css';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!token) {
      setError('Missing reset token. Please use the link from your email.');
      return;
    }

    setIsLoading(true);
    try {
      await AuthService.resetPassword({ token, new_password: newPassword });
      setSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Password reset failed.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h2 className={styles.title}>Password updated</h2>
          <p className={styles.subtitle}>Your password has been changed successfully.</p>
          <Link href="/" className={styles.backLink}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h2 className={styles.title}>Invalid link</h2>
          <p className={styles.subtitle}>
            This reset link is missing a token. Please request a new one.
          </p>
          <Link href="/" className={styles.backLink}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.title}>Set a new password</h2>
        <p className={styles.subtitle}>Choose a new password for your account.</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="new-password" className={styles.label}>
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={styles.input}
              placeholder="Min 8 characters"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="confirm-password" className={styles.label}>
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={styles.input}
              placeholder="Repeat new password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.submitButton} disabled={isLoading}>
            {isLoading ? 'Updating…' : 'Update password'}
          </button>
        </form>

        <div className={styles.footer}>
          <Link href="/" className={styles.backLink}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
