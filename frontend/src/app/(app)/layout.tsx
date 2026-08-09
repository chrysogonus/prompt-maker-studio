'use client';

import { useState, useEffect, useCallback } from 'react';
import AuthForm from '@/components/AuthForm';
import NavBar from '@/components/NavBar';
import EmailReminderBanner from '@/components/EmailReminderBanner';
import Button from '@/components/ui/Button';
import { AuthContext } from '@/lib/auth-context';
import { AuthService, SESSION_EXPIRED_EVENT } from '@/lib/auth';
import styles from './layout.module.css';
import { APP_NAME } from '@/lib/branding';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authCheckError, setAuthCheckError] = useState('');
  const [sessionWarning, setSessionWarning] = useState('');
  const [isSessionUrgent, setIsSessionUrgent] = useState(false);

  const checkAuth = useCallback(async () => {
    // Keep mount effects free of synchronous state writes; the auth check is
    // inherently asynchronous — the session cookie is httpOnly, so only the
    // server can say whether it is still good.
    await Promise.resolve();
    setIsCheckingAuth(true);
    setAuthCheckError('');
    if (AuthService.isAuthenticated()) {
      try {
        const user = await AuthService.getCurrentUser();
        setCurrentUser(user.username);
        setIsAuthenticated(true);
      } catch (err) {
        // getCurrentUser drops the session on a real 401. A network or 5xx
        // failure must not destroy a durable session during page reload.
        if (AuthService.isAuthenticated()) {
          console.error('Auth check failed:', err);
          setAuthCheckError('Your session is still saved, but it could not be verified.');
        } else {
          setIsAuthenticated(false);
        }
      }
    } else {
      setIsAuthenticated(false);
    }
    setIsCheckingAuth(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkAuth(), 0);
    return () => window.clearTimeout(timer);
  }, [checkAuth]);

  // The browser's back/forward cache can restore an authenticated page after
  // sign-out without re-running mount effects, so the session must be
  // re-checked whenever the page is restored from history or regains
  // visibility — otherwise account data stays readable after logout.
  useEffect(() => {
    const revalidate = () => {
      if (!AuthService.isAuthenticated()) {
        setIsAuthenticated(false);
        setCurrentUser(null);
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) revalidate();
    };
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setAuthCheckError('');
      setIsCheckingAuth(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const updateWarning = () => {
      const expiresAt = AuthService.getTokenExpiryMs?.();
      if (!expiresAt) return;
      const secondsRemaining = (expiresAt - Date.now()) / 1000;
      if (secondsRemaining <= 15) { // 15-second buffer for clock skew/latency
        AuthService.removeToken();
        return;
      }
      const minutesRemaining = Math.ceil(secondsRemaining / 60);
      setIsSessionUrgent(minutesRemaining <= 2);
      setSessionWarning(
        minutesRemaining > 0 && minutesRemaining <= 5
          ? `Your session expires in about ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}. Save in-progress work before signing in again.`
          : '',
      );
    };
    const initialTimer = window.setTimeout(updateWarning, 0);
    const interval = window.setInterval(updateWarning, 10_000); // Check more frequently (every 10s) as we get closer
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [isAuthenticated]);

  const handleAuthSuccess = async () => {
    try {
      const user = await AuthService.getCurrentUser();
      setCurrentUser(user.username);
      setIsAuthenticated(true);
    } catch (err) {
      console.error('Failed to get user info:', err);
    }
  };

  // Applied once per mount of the authenticated shell; Settings owns the toggle controls.
  useEffect(() => {
    const storedTheme = localStorage.getItem('theme');
    document.documentElement.setAttribute('data-theme', storedTheme === 'light' ? 'light' : 'dark');

    const storedDensity = localStorage.getItem('density');
    document.documentElement.setAttribute(
      'data-density',
      storedDensity === 'compact' ? 'compact' : 'comfortable'
    );
  }, []);

  const logout = () => {
    AuthService.logout();
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  if (isCheckingAuth) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (authCheckError) {
    return (
      <div className={styles.authError} role="alert">
        <p>{authCheckError}</p>
        <Button variant="primary" onClick={checkAuth}>
          Retry session check
        </Button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthForm onSuccess={handleAuthSuccess} />;
  }

  return (
    <AuthContext.Provider value={{ currentUser, logout }}>
      <div id="app-shell" className={styles.shell}>
        <a className={styles.skipLink} href="#main-content">
          Skip to main content
        </a>
        <NavBar />
        <EmailReminderBanner />
        {sessionWarning && (
          <div
            className={styles.sessionWarning}
            data-urgent={isSessionUrgent}
            role="status"
            aria-live="polite"
          >
            {isSessionUrgent ? 'Warning: ' : 'Session: '}{sessionWarning}
          </div>
        )}
        <main id="main-content" className={styles.content}>
          {children}
        </main>
        <footer className={styles.footer} role="contentinfo">
          <div className={styles.footerContent}>
            &copy; {new Date().getFullYear()} {APP_NAME}. Licensed under{' '}
            <a href="https://github.com/chrysogonus/prompt-maker-studio/blob/main/LICENSE">
              Apache-2.0
            </a>
            .
          </div>
        </footer>
      </div>
    </AuthContext.Provider>
  );
}
