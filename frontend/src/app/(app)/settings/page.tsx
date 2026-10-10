/**
 * Settings, top to bottom: profile and sign-in, appearance, how the library
 * opens, the optional AI connection (bring-your-own provider, or the
 * operator's default), data export, and account deletion.
 */

'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthService } from '@/lib/auth';
import { ApiClient } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { User, UserUpdate } from '@/types/auth';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import LLMConnectionForm from '@/components/LLMConnectionForm';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import SegmentedControl from '@/components/ui/SegmentedControl';
import {
  ActionCompleteIcon,
  DarkThemeIcon,
  DownloadIcon,
  GridViewIcon,
  LightThemeIcon,
  ListViewIcon,
  LoadingIcon,
} from '@/components/ui/icon';
import styles from './page.module.css';
import { APP_SLUG, pageTitle } from '@/lib/branding';

type Theme = 'light' | 'dark';
type PreferenceSaveStatus = 'saving' | 'saved';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: <LightThemeIcon size={14} tone="inherit" /> },
  { value: 'dark', label: 'Dark', icon: <DarkThemeIcon size={14} tone="inherit" /> },
] as const;

const LIBRARY_VIEW_OPTIONS = [
  { value: 'list', label: 'List', icon: <ListViewIcon size={14} tone="inherit" /> },
  { value: 'grid', label: 'Grid', icon: <GridViewIcon size={14} tone="inherit" /> },
] as const;

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}

export default function SettingsPage() {
  const { currentUser, logout } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [viewSave, setViewSave] = useState<PreferenceSaveStatus | null>(null);
  const [showUsernameEdit, setShowUsernameEdit] = useState(false);
  const [newUsernameValue, setNewUsernameValue] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [showEmailEdit, setShowEmailEdit] = useState(false);
  const [newEmailValue, setNewEmailValue] = useState('');
  const [emailError, setEmailError] = useState('');
  const [prefsError, setPrefsError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isSigningOutEverywhere, setIsSigningOutEverywhere] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const preferenceSaveSequence = useRef(0);
  const preferenceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = pageTitle('Settings');
    return () => {
      document.title = pageTitle();
    };
  }, []);

  useEffect(() => {
    AuthService.getCurrentUser()
      .then(setUser)
      .catch(() => {});
  }, []);

  useEffect(
    () => () => {
      if (preferenceSaveTimer.current) clearTimeout(preferenceSaveTimer.current);
    },
    [],
  );

  const toggleTheme = (next: Theme) => {
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  // Both profile forms are noValidate: the native browser tooltip is invisible
  // to some tooling/screen readers and inconsistent with the inline error
  // pattern the password form on this page already uses.
  const handleUsernameChange = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newUsernameValue.trim();
    if (!trimmed) {
      setUsernameError('Username cannot be empty.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(trimmed)) {
      setUsernameError(
        'Username must be 3-50 characters using only letters, digits, underscores, and hyphens.',
      );
      return;
    }
    setUsernameError('');
    try {
      await AuthService.updateProfile({ new_username: trimmed });
      // Token subject was the old username — force re-login, same as before.
      logout();
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : 'Failed to update username.');
    }
  };

  const handleEmailChange = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newEmailValue.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError('');
    try {
      const updated = await AuthService.updateProfile({ email: trimmed });
      setUser(updated);
      setShowEmailEdit(false);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to update email.');
    }
  };

  const handleDefaultLibraryViewChange = async (view: 'grid' | 'list') => {
    const update: UserUpdate = { default_library_view: view };
    const sequence = ++preferenceSaveSequence.current;
    if (preferenceSaveTimer.current) clearTimeout(preferenceSaveTimer.current);
    setPrefsError('');
    setViewSave('saving');
    try {
      const updated = await AuthService.updateProfile(update);
      if (preferenceSaveSequence.current !== sequence) return;
      setUser(updated);
      setViewSave('saved');
      preferenceSaveTimer.current = setTimeout(() => {
        if (preferenceSaveSequence.current === sequence) setViewSave(null);
      }, 1500);
    } catch (err) {
      if (preferenceSaveSequence.current !== sequence) return;
      setViewSave(null);
      setPrefsError(err instanceof Error ? err.message : 'Failed to update default library view.');
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportError('');
    setExportSuccess('');
    try {
      const blob = await ApiClient.exportPrompts();
      const filename = `${APP_SLUG}-export.json`;
      downloadBlob(blob, filename);
      setExportSuccess(`Exported your prompts to ${filename}`);
      setTimeout(() => {
        setExportSuccess((prev) => (prev.includes(filename) ? '' : prev));
      }, 5000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export prompts.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    setIsSigningOutEverywhere(true);
    setSignOutError(null);
    try {
      await AuthService.logoutEverywhere();
      logout();
    } catch (err) {
      setSignOutError(
        err instanceof Error ? err.message : 'Failed to sign out your other sessions.',
      );
      setIsSigningOutEverywhere(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      await ApiClient.deleteAccount(deletePassword);
      logout();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account.');
      // The confirmation stays open so a mistyped password can be corrected,
      // rather than making the user start the flow again.
      setIsDeleting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError('');
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section} id="s-profile" aria-labelledby="h-profile">
        <div className={styles.intro}>
          <h2 id="h-profile">Profile</h2>
          <p>Used to sign in and to recover your account.</p>
        </div>
        <div className={styles.body}>
          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>Username</div>
              <div className={styles.rowValue}>{currentUser}</div>
            </div>
            {!showUsernameEdit && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNewUsernameValue(currentUser ?? '');
                  setShowUsernameEdit(true);
                  setUsernameError('');
                }}
              >
                Edit username
              </Button>
            )}
          </div>
          {showUsernameEdit && (
            <form onSubmit={handleUsernameChange} className={styles.inlineForm} noValidate>
              <Input
                value={newUsernameValue}
                onChange={(e) => setNewUsernameValue(e.target.value)}
                aria-label="New username"
                minLength={3}
                maxLength={50}
                required
                autoFocus
              />
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowUsernameEdit(false)}>
                Cancel
              </Button>
              <p className={styles.hint}>Changing your username signs you out.</p>
            </form>
          )}
          {usernameError && <div className={styles.error} role="alert">{usernameError}</div>}

          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>Email</div>
              <div className={styles.rowValue}>{user?.email || 'No email on file'}</div>
            </div>
            {!showEmailEdit && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNewEmailValue(user?.email ?? '');
                  setShowEmailEdit(true);
                  setEmailError('');
                }}
              >
                Edit email
              </Button>
            )}
          </div>
          {showEmailEdit && (
            <form onSubmit={handleEmailChange} className={styles.inlineForm} noValidate>
              <Input
                type="email"
                value={newEmailValue}
                onChange={(e) => setNewEmailValue(e.target.value)}
                aria-label="New email"
                placeholder="you@example.com"
                required
                autoFocus
              />
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowEmailEdit(false)}>
                Cancel
              </Button>
            </form>
          )}
          {emailError && <div className={styles.error} role="alert">{emailError}</div>}
        </div>
      </section>

      <section className={styles.section} id="s-security" aria-labelledby="h-security">
        <div className={styles.intro}>
          <h2 id="h-security">Password and sessions</h2>
          <p>Changing your password signs out every other device.</p>
        </div>
        <div className={styles.body}>
          <ChangePasswordForm />
          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>Sign out everywhere</div>
              <p className={styles.hint}>
                Including devices you no longer have. You will need to sign in again here.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={handleSignOutEverywhere}
              disabled={isSigningOutEverywhere}
            >
              {isSigningOutEverywhere ? 'Signing out…' : 'Sign out everywhere'}
            </Button>
          </div>
          {signOutError && <div className={styles.error} role="alert">{signOutError}</div>}
        </div>
      </section>

      <section className={styles.section} id="s-preferences" aria-labelledby="h-preferences">
        <div className={styles.intro}>
          <h2 id="h-preferences">Appearance and library</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.row}>
            <div className={styles.rowLabel}>Theme</div>
            <SegmentedControl aria-label="Theme" options={THEME_OPTIONS} value={theme} onChange={toggleTheme} />
          </div>
          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>Library opens as</div>
            </div>
            <div className={styles.withFeedback}>
              <SegmentedControl
                aria-label="Default library view"
                options={LIBRARY_VIEW_OPTIONS}
                value={user?.default_library_view ?? 'list'}
                onChange={handleDefaultLibraryViewChange}
              />
              <span className={styles.feedback} aria-live="polite">
                {viewSave === 'saving' && <LoadingIcon size={16} label="Saving preference" />}
                {viewSave === 'saved' && (
                  <ActionCompleteIcon size={16} tone="success" label="Preference saved" />
                )}
              </span>
            </div>
          </div>
          {prefsError && <div className={styles.error} role="alert">{prefsError}</div>}
        </div>
      </section>

      <section className={styles.section} id="s-api" aria-labelledby="h-api">
        <div className={styles.intro}>
          <h2 id="h-api">AI connection</h2>
          <p>Optional. Everything else works without it.</p>
        </div>
        <div className={styles.body}>
          <p className={styles.text}>
            The AI connection powers <strong>Import text</strong>, which turns a pasted prompt or
            rough notes into sections you can edit. Connect your own OpenAI-compatible provider, or
            use this server&apos;s default connection when it offers one.
          </p>
          <LLMConnectionForm />
        </div>
      </section>

      <section className={styles.section} id="s-data" aria-labelledby="h-data">
        <div className={styles.intro}>
          <h2 id="h-data">Your data</h2>
        </div>
        <div className={styles.body}>
          <p className={styles.text}>
            Download every prompt with its folders and full version history as a JSON file.
          </p>
          <div>
            <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
              <DownloadIcon size={16} tone="inherit" />
              {isExporting ? 'Exporting…' : 'Export all prompts'}
            </Button>
          </div>
          {exportError && <div className={styles.error}>{exportError}</div>}
          {exportSuccess && <div className={styles.success}>{exportSuccess}</div>}
        </div>
      </section>

      <section className={styles.section} id="s-danger" aria-labelledby="h-danger">
        <div className={styles.intro}>
          <h2 id="h-danger" className={styles.danger}>
            Delete account
          </h2>
        </div>
        <div className={styles.body}>
          <p className={styles.text}>
            Permanently deletes your account and all your prompts. This can&apos;t be undone.
          </p>
          {!showDeleteConfirm ? (
            <div>
              <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                Delete account…
              </Button>
            </div>
          ) : (
            <div className={styles.confirm}>
              <p>Enter your password to delete your account and every prompt in it.</p>
              <Input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Your password"
                aria-label="Confirm your password"
                aria-invalid={!!deleteError}
                autoComplete="current-password"
                disabled={isDeleting}
              />
              <div className={styles.confirmActions}>
                <Button
                  variant="danger"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || deletePassword.length === 0}
                >
                  {isDeleting ? 'Deleting…' : 'Delete my account'}
                </Button>
                <Button variant="secondary" onClick={closeDeleteConfirm} disabled={isDeleting}>
                  Cancel
                </Button>
              </div>
              {deleteError && (
                <div className={styles.error} role="alert">
                  {deleteError}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
