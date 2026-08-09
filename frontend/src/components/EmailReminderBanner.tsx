/**
 * Dismissible reminder shown after login for legacy accounts (created
 * before email became required) that still have a null email — password
 * recovery is unavailable to them until they add one.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AuthService } from '@/lib/auth';
import styles from './EmailReminderBanner.module.css';
import { storageKey } from '@/lib/branding';

const DISMISS_KEY_PREFIX = storageKey('email-banner-dismissed');

export default function EmailReminderBanner() {
  const [username, setUsername] = useState<string | null>(null);
  const [hasEmail, setHasEmail] = useState(true);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Fetched fresh on every mount (not just read from the dismiss flag) so the
    // banner naturally stops appearing the moment a user adds an email, rather
    // than requiring them to also dismiss it.
    AuthService.getCurrentUser()
      .then((user) => {
        setUsername(user.username);
        setHasEmail(!!user.email);
        setDismissed(localStorage.getItem(`${DISMISS_KEY_PREFIX}:${user.username}`) === 'true');
      })
      .catch(() => {});
  }, []);

  if (!username || hasEmail || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(`${DISMISS_KEY_PREFIX}:${username}`, 'true');
    setDismissed(true);
  };

  return (
    <div className={styles.banner} role="status">
      <span className={styles.message}>
        Add an email address to enable password recovery.
      </span>
      <div className={styles.actions}>
        <Link href="/settings#s-profile" className={styles.link}>
          Add email
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className={styles.dismissButton}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
