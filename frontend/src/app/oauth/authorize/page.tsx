/**
 * OAuth consent page — where an MCP client such as ChatGPT sends the user to
 * link their account.
 *
 * URL shape: /oauth/authorize?request=<signed request>
 *
 * The backend's /api/oauth/authorize validates the client's request and
 * redirects here with it signed. The user signs in (or creates an account) if
 * needed, then approves or denies; either way the backend returns the client
 * redirect and the browser follows it back to the app that asked.
 */

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AuthForm from '@/components/AuthForm';
import Button from '@/components/ui/Button';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import { APP_NAME } from '@/lib/branding';
import type { OAuthConsentDetails } from '@/types/oauth';
import styles from './page.module.css';

type Phase = 'checking' | 'sign-in' | 'consent' | 'redirecting' | 'error';

const MISSING_REQUEST = 'This link is missing its connection request. Start again from the app.';

function AuthorizeConsent() {
  const request = useSearchParams().get('request') ?? '';
  const [phase, setPhase] = useState<Phase>('checking');
  const [details, setDetails] = useState<OAuthConsentDetails | null>(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    // Mount effects stay free of synchronous state writes; see (app)/layout.tsx.
    await Promise.resolve();
    if (!request) {
      setError(MISSING_REQUEST);
      setPhase('error');
      return;
    }
    if (!AuthService.isAuthenticated()) {
      setPhase('sign-in');
      return;
    }
    try {
      const [user, consent] = await Promise.all([
        AuthService.getCurrentUser(),
        ApiClient.getOAuthConsent(request),
      ]);
      setUsername(user.username);
      setDetails(consent);
      setPhase('consent');
    } catch (err) {
      if (!AuthService.isAuthenticated()) {
        setPhase('sign-in');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load the connection request.');
      setPhase('error');
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const decide = async (approve: boolean) => {
    setPhase('redirecting');
    try {
      const { redirect_url } = await ApiClient.decideOAuthConsent(request, approve);
      window.location.assign(redirect_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the connection request.');
      setPhase('error');
    }
  };

  if (phase === 'sign-in') {
    return <AuthForm onSuccess={() => void load()} />;
  }

  if (phase === 'error') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>Can&apos;t connect</h1>
          <p className={styles.subtitle} role="alert">
            {error}
          </p>
          <Link href="/" className={styles.backLink}>
            Go to {APP_NAME}
          </Link>
        </div>
      </div>
    );
  }

  if (phase !== 'consent' || !details) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <p className={styles.subtitle} role="status">
            {phase === 'redirecting' ? 'Returning you to the app…' : 'Loading…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Connect {details.client_name}?</h1>
        <p className={styles.subtitle}>
          {details.client_name} is asking to use your {APP_NAME} prompt library. You are signed
          in as <strong>{username}</strong>.
        </p>
        <p className={styles.sectionLabel}>It will be able to:</p>
        <ul className={styles.list}>
          <li>See your saved prompts and their version history</li>
          <li>Save new prompts and update existing ones (earlier versions are kept)</li>
        </ul>
        <p className={styles.note}>
          It cannot delete prompts or change your account. You can disconnect it at any time with
          &ldquo;Sign out everywhere&rdquo; in Settings. Approving returns you to{' '}
          <strong>{details.redirect_host}</strong>.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void decide(false)}>
            Deny
          </Button>
          <Button variant="primary" onClick={() => void decide(true)}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense>
      <AuthorizeConsent />
    </Suspense>
  );
}
