'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import AuthForm from '@/features/auth/AuthForm';
import Sidebar from '@/components/shell/Sidebar';
import { MenuIcon, NewIcon } from '@/components/ui/icon';
import EmailReminderBanner from '@/features/auth/EmailReminderBanner';
import LegalLinks from '@/components/LegalLinks';
import Button from '@/components/ui/Button';
import { LibraryDataProvider } from '@/features/library/LibraryData';
import { AuthContext } from '@/lib/auth-context';

import styles from './AppShell.module.css';
import { APP_NAME } from '@/lib/branding';
import { useSession } from '@/features/auth/useSession';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const {
    isAuthenticated,
    isCheckingAuth,
    currentUser,
    authCheckError,
    sessionWarning,
    isSessionUrgent,
    checkAuth,
    handleAuthSuccess,
    logout,
  } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      <LibraryDataProvider key={currentUser}>
        <div id="app-shell" className={styles.shell}>
          <a className={styles.skipLink} href="#main-content">
            Skip to main content
          </a>
          <Suspense>
            <Sidebar open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
          </Suspense>
          {drawerOpen && (
            <div className={styles.scrim} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          )}
          <div className={styles.column}>
            <header className={styles.topbar}>
              <button
                type="button"
                className={styles.menuButton}
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
              >
                <MenuIcon size={18} tone="inherit" />
              </button>
              <span className={styles.topbarTitle}>{APP_NAME}</span>
              <Link href="/editor/new" className={styles.topbarNew}>
                <NewIcon size={16} tone="inherit" />
                New
              </Link>
            </header>
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
              &copy; {new Date().getFullYear()} {APP_NAME}. Licensed under{' '}
              <a href="https://github.com/chrysogonus/prompt-maker-studio/blob/main/LICENSE">
                Apache-2.0
              </a>
              .
              <LegalLinks className={styles.legalLinks} />
            </footer>
          </div>
        </div>
      </LibraryDataProvider>
    </AuthContext.Provider>
  );
}
