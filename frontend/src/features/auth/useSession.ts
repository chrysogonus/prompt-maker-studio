'use client';

import { useState, useEffect, useCallback } from 'react';

import { AuthService, SESSION_EXPIRED_EVENT } from '@/lib/auth';

// Real input keeps the session alive. Shorter sessions renew halfway through
// their lifetime; longer ones renew every five minutes to limit requests.
const ACTIVITY_RENEWAL_INTERVAL_MS = 5 * 60 * 1000;

export function useSession() {
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
          ? `Your session expires in about ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'} unless you keep working.`
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

  // Only deliberate input counts, so an idle open tab still expires. The server
  // refuses renewal once the session reaches its maximum length.
  useEffect(() => {
    if (!isAuthenticated) return;
    // The first input after mount renews at once: a reloaded page may be
    // minutes from expiry.
    let lastRenewal = 0;
    const renew = () => {
      const now = Date.now();
      const expiresAt = AuthService.getTokenExpiryMs();
      const interval = expiresAt === null ? ACTIVITY_RENEWAL_INTERVAL_MS : Math.min(
        ACTIVITY_RENEWAL_INTERVAL_MS,
        (expiresAt - lastRenewal) / 2,
      );
      if (now - lastRenewal < interval) return;
      lastRenewal = now;
      AuthService.refreshSession().catch(() => {});
    };
    window.addEventListener('keydown', renew, { passive: true });
    window.addEventListener('pointerdown', renew, { passive: true });
    return () => {
      window.removeEventListener('keydown', renew);
      window.removeEventListener('pointerdown', renew);
    };
  }, [isAuthenticated]);

  const handleAuthSuccess = async () => {
    try {
      const user = await AuthService.getCurrentUser();
      setCurrentUser(user.username);
      setIsAuthenticated(true);
    } catch {
      if (AuthService.isAuthenticated()) {
        setAuthCheckError('Your session is still saved, but it could not be verified.');
      }
    }
  };

  // Applied once per mount of the authenticated shell; Settings owns the toggle control.
  useEffect(() => {
    const storedTheme = localStorage.getItem('theme');
    // Light unless the user chose dark.
    document.documentElement.setAttribute('data-theme', storedTheme === 'dark' ? 'dark' : 'light');
  }, []);

  const logout = () => {
    AuthService.logout();
    setIsAuthenticated(false);
    setCurrentUser(null);
  };
  return {
    isAuthenticated,
    isCheckingAuth,
    currentUser,
    setCurrentUser,
    authCheckError,
    sessionWarning,
    isSessionUrgent,
    checkAuth,
    handleAuthSuccess,
    logout,
  };
}
