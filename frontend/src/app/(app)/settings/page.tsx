/**
 * Settings — full sectioned layout: Profile, Preferences, Notifications,
 * API access, Data, Danger zone. API access is the editable bring-your-own
 * LLM provider connection (LLMConnectionForm) — provider, endpoint, model,
 * and the user's own API key, which every AI feature runs against.
 * Weekly-summary emails are sent by a cron-invoked script
 * (`make send-weekly-summary`), not an in-process scheduler. See
 * product/DECISIONS.md for both adaptations.
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
import Card from '@/components/ui/Card';
import Toggle from '@/components/ui/Toggle';
import SegmentedControl from '@/components/ui/SegmentedControl';
import {
  ActionCompleteIcon,
  ApiAccessIcon,
  ComfortableDensityIcon,
  CompactDensityIcon,
  DangerIcon,
  DarkThemeIcon,
  DataIcon,
  DownloadIcon,
  GridViewIcon,
  LightThemeIcon,
  ListViewIcon,
  LoadingIcon,
  NotificationsIcon,
  PreferencesIcon,
  ProfileIcon,
} from '@/components/ui/icon';
import styles from './page.module.css';
import { APP_SLUG, pageTitle } from '@/lib/branding';

type Theme = 'light' | 'dark';
type Density = 'comfortable' | 'compact';
type PreferenceSaveTarget = 'library-view' | 'eval-method' | 'auto-run';
type PreferenceSaveStatus = 'saving' | 'saved';

const SETTINGS_SECTION_IDS = [
  's-profile',
  's-preferences',
  's-notifications',
  's-api',
  's-data',
  's-danger',
] as const;

const THEME_OPTIONS = [
  {
    value: 'light',
    label: 'Light',
    icon: <LightThemeIcon size={14} tone="inherit" />,
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <DarkThemeIcon size={14} tone="inherit" />,
  },
] as const;

const DENSITY_OPTIONS = [
  {
    value: 'comfortable',
    label: 'Comfortable',
    icon: <ComfortableDensityIcon size={14} tone="inherit" />,
  },
  {
    value: 'compact',
    label: 'Compact',
    icon: <CompactDensityIcon size={14} tone="inherit" />,
  },
] as const;

const LIBRARY_VIEW_OPTIONS = [
  {
    value: 'grid',
    label: 'Grid',
    icon: <GridViewIcon size={14} tone="inherit" />,
  },
  {
    value: 'list',
    label: 'List',
    icon: <ListViewIcon size={14} tone="inherit" />,
  },
] as const;

const EVAL_METHOD_OPTIONS = [
  { value: 'rule', label: 'Rule' },
  { value: 'judge', label: 'Judge' },
  { value: 'manual', label: 'Manual' },
] as const;

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('theme') as Theme) || 'dark';
}

function readStoredDensity(): Density {
  if (typeof window === 'undefined') return 'comfortable';
  return (localStorage.getItem('density') as Density) || 'comfortable';
}

export default function SettingsPage() {
  const { currentUser, logout } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [density, setDensity] = useState<Density>(readStoredDensity);
  const [activeSection, setActiveSection] = useState<(typeof SETTINGS_SECTION_IDS)[number]>(
    's-profile',
  );
  const [preferenceSave, setPreferenceSave] = useState<{
    target: PreferenceSaveTarget;
    status: PreferenceSaveStatus;
  } | null>(null);
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

  useEffect(() => {
    const hashSection = window.location.hash.slice(1);
    if (SETTINGS_SECTION_IDS.some((id) => id === hashSection)) {
      setActiveSection(hashSection as (typeof SETTINGS_SECTION_IDS)[number]);
    }

    let animationFrame: number | null = null;
    const updateActiveSection = () => {
      animationFrame = null;
      const activationLine = Math.min(160, window.innerHeight * 0.25);
      let nextSection: (typeof SETTINGS_SECTION_IDS)[number] = SETTINGS_SECTION_IDS[0];

      for (const id of SETTINGS_SECTION_IDS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= activationLine) {
          nextSection = id;
        }
      }

      const documentHeight = document.documentElement.scrollHeight;
      if (
        documentHeight > window.innerHeight &&
        window.scrollY + window.innerHeight >= documentHeight - 2
      ) {
        nextSection = SETTINGS_SECTION_IDS[SETTINGS_SECTION_IDS.length - 1];
      }
      setActiveSection(nextSection);
    };
    const scheduleUpdate = () => {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(updateActiveSection);
      }
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
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

  const setDensityPreference = (next: Density) => {
    setDensity(next);
    localStorage.setItem('density', next);
    document.documentElement.setAttribute('data-density', next);
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

  const handleToggleNotifyRunFailure = async (checked: boolean) => {
    setPrefsError('');
    try {
      const updated = await AuthService.updateProfile({ notify_run_failure: checked });
      setUser(updated);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Failed to update notification preference.');
    }
  };

  const handleToggleNotifyWeeklySummary = async (checked: boolean) => {
    setPrefsError('');
    try {
      const updated = await AuthService.updateProfile({ notify_weekly_summary: checked });
      setUser(updated);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Failed to update notification preference.');
    }
  };

  const updatePreference = async (
    target: PreferenceSaveTarget,
    update: UserUpdate,
    errorMessage: string,
  ) => {
    const sequence = ++preferenceSaveSequence.current;
    if (preferenceSaveTimer.current) clearTimeout(preferenceSaveTimer.current);
    setPrefsError('');
    setPreferenceSave({ target, status: 'saving' });
    try {
      const updated = await AuthService.updateProfile(update);
      if (preferenceSaveSequence.current !== sequence) return;

      setUser(updated);
      setPreferenceSave({ target, status: 'saved' });
      preferenceSaveTimer.current = setTimeout(() => {
        if (preferenceSaveSequence.current === sequence) setPreferenceSave(null);
      }, 1500);
    } catch (err) {
      if (preferenceSaveSequence.current !== sequence) return;
      setPreferenceSave(null);
      setPrefsError(err instanceof Error ? err.message : errorMessage);
    }
  };

  const handleDefaultLibraryViewChange = async (view: 'grid' | 'list') => {
    await updatePreference(
      'library-view',
      { default_library_view: view },
      'Failed to update default library view.',
    );
  };

  const handleDefaultEvalMethodChange = async (method: 'rule' | 'judge' | 'manual') => {
    await updatePreference(
      'eval-method',
      { default_eval_method: method },
      'Failed to update default eval method.',
    );
  };

  const handleToggleAutoRunEvalOnUpdate = async (checked: boolean) => {
    await updatePreference(
      'auto-run',
      { auto_run_eval_on_update: checked },
      'Failed to update auto-run preference.',
    );
  };

  const handleToggleNotifyEvalComplete = async (checked: boolean) => {
    setPrefsError('');
    try {
      const updated = await AuthService.updateProfile({ notify_eval_complete: checked });
      setUser(updated);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Failed to update notification preference.');
    }
  };

  const handleToggleNotifyEvalRegression = async (checked: boolean) => {
    setPrefsError('');
    try {
      const updated = await AuthService.updateProfile({ notify_eval_regression: checked });
      setUser(updated);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Failed to update notification preference.');
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
      setExportSuccess(`Successfully exported prompts to ${filename}`);
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
      // The banner stays open so a mistyped password can be corrected, rather
      // than making the user start the flow again.
      setIsDeleting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError('');
  };

  const preferenceSaveFeedback = (target: PreferenceSaveTarget) => {
    const status = preferenceSave?.target === target ? preferenceSave.status : null;
    return (
      <span className={styles.saveFeedback} aria-live="polite">
        {status === 'saving' && (
          <>
            <LoadingIcon size={16} tone="muted" />
            <span className={styles.visuallyHidden}>Saving preference</span>
          </>
        )}
        {status === 'saved' && (
          <>
            <ActionCompleteIcon size={16} tone="success" />
            <span className={styles.visuallyHidden}>Preference saved</span>
          </>
        )}
      </span>
    );
  };

  return (
    <div className={styles.layout}>
      <nav className={styles.rail} aria-label="Settings sections">
        <h1 className={styles.title}>Settings</h1>
        <a
          href="#s-profile"
          className={styles.railLink}
          data-active={activeSection === 's-profile'}
          aria-current={activeSection === 's-profile' ? 'location' : undefined}
          onClick={() => setActiveSection('s-profile')}
        >
          <ProfileIcon size={18} tone="inherit" />
          Profile
        </a>
        <a
          href="#s-preferences"
          className={styles.railLink}
          data-active={activeSection === 's-preferences'}
          aria-current={activeSection === 's-preferences' ? 'location' : undefined}
          onClick={() => setActiveSection('s-preferences')}
        >
          <PreferencesIcon size={18} tone="inherit" />
          Preferences
        </a>
        <a
          href="#s-notifications"
          className={styles.railLink}
          data-active={activeSection === 's-notifications'}
          aria-current={activeSection === 's-notifications' ? 'location' : undefined}
          onClick={() => setActiveSection('s-notifications')}
        >
          <NotificationsIcon size={18} tone="inherit" />
          Notifications
        </a>
        <a
          href="#s-api"
          className={styles.railLink}
          data-active={activeSection === 's-api'}
          aria-current={activeSection === 's-api' ? 'location' : undefined}
          onClick={() => setActiveSection('s-api')}
        >
          <ApiAccessIcon size={18} tone="inherit" />
          API access
        </a>
        <a
          href="#s-data"
          className={styles.railLink}
          data-active={activeSection === 's-data'}
          aria-current={activeSection === 's-data' ? 'location' : undefined}
          onClick={() => setActiveSection('s-data')}
        >
          <DataIcon size={18} tone="inherit" />
          Data
        </a>
        <a
          href="#s-danger"
          className={styles.railLinkDanger}
          data-active={activeSection === 's-danger'}
          aria-current={activeSection === 's-danger' ? 'location' : undefined}
          onClick={() => setActiveSection('s-danger')}
        >
          <DangerIcon size={18} tone="inherit" />
          Danger zone
        </a>
      </nav>

      <div className={styles.settings}>
        <section className={styles.section} id="s-profile">
          <h2 className={styles.sectionLabel}>Profile</h2>
          <Card className={styles.card}>
            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Username</div>
                <div className={styles.rowHint}>{currentUser}</div>
              </div>
              {!showUsernameEdit ? (
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
              ) : (
                <form onSubmit={handleUsernameChange} className={styles.inlineForm} noValidate>
                  <Input
                    value={newUsernameValue}
                    onChange={(e) => setNewUsernameValue(e.target.value)}
                    minLength={3}
                    maxLength={50}
                    pattern="[a-zA-Z0-9_-]+"
                    title="3-50 chars; letters, digits, underscores, hyphens"
                    required
                    autoFocus
                  />
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowUsernameEdit(false)}>
                    Cancel
                  </Button>
                </form>
              )}
            </div>
            {usernameError && <div className={styles.error} role="alert">{usernameError}</div>}

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Email</div>
                <div className={styles.rowHint}>{user?.email || 'No email on file'}</div>
              </div>
              {!showEmailEdit ? (
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
              ) : (
                <form onSubmit={handleEmailChange} className={styles.inlineForm} noValidate>
                  <Input
                    type="email"
                    value={newEmailValue}
                    onChange={(e) => setNewEmailValue(e.target.value)}
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
            </div>
            {emailError && <div className={styles.error} role="alert">{emailError}</div>}

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Password</div>
                <div className={styles.rowHint}>
                  Change your account password. This signs out every other device.
                </div>
              </div>
              <ChangePasswordForm />
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Active sessions</div>
                <div className={styles.rowHint}>
                  Sign out everywhere, including devices you no longer have. You will need to
                  sign in again here.
                </div>
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
          </Card>
        </section>

        <section className={styles.section} id="s-preferences">
          <h2 className={styles.sectionLabel}>Preferences</h2>
          <Card className={styles.card}>
            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Theme</div>
                <div className={styles.rowHint}>Applies across the whole app</div>
              </div>
              <SegmentedControl
                aria-label="Theme"
                options={THEME_OPTIONS}
                value={theme}
                onChange={toggleTheme}
              />
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Density</div>
                <div className={styles.rowHint}>Spacing in lists and cards</div>
              </div>
              <SegmentedControl
                aria-label="Density"
                options={DENSITY_OPTIONS}
                value={density}
                onChange={setDensityPreference}
              />
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Default library view</div>
                <div className={styles.rowHint}>Grid or list when you open the Library</div>
              </div>
              <div className={styles.controlWithFeedback}>
                <SegmentedControl
                  aria-label="Default library view"
                  options={LIBRARY_VIEW_OPTIONS}
                  value={user?.default_library_view ?? 'grid'}
                  onChange={handleDefaultLibraryViewChange}
                />
                {preferenceSaveFeedback('library-view')}
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Default eval scoring method</div>
                <div className={styles.rowHint}>Applied to new cases you add in Evaluate</div>
              </div>
              <div className={styles.controlWithFeedback}>
                <SegmentedControl
                  aria-label="Default eval scoring method"
                  options={EVAL_METHOD_OPTIONS}
                  value={user?.default_eval_method ?? 'rule'}
                  onChange={handleDefaultEvalMethodChange}
                />
                {preferenceSaveFeedback('eval-method')}
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Auto-run evaluation on Update</div>
                <div className={styles.rowHint}>
                  Automatically re-score against the eval set whenever you click Update in
                  Editor Detail
                </div>
              </div>
              <div className={styles.controlWithFeedback}>
                <Toggle
                  checked={user?.auto_run_eval_on_update ?? false}
                  onChange={handleToggleAutoRunEvalOnUpdate}
                  label="Auto-run evaluation on Update"
                />
                {preferenceSaveFeedback('auto-run')}
              </div>
            </div>
            {prefsError && <div className={styles.error}>{prefsError}</div>}
          </Card>
        </section>

        <section className={styles.section} id="s-notifications">
          <h2 className={styles.sectionLabel}>Notifications</h2>
          <Card className={styles.card}>
            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Run failures</div>
                <div className={styles.rowHint}>Email me when a Playground run errors out</div>
              </div>
              <Toggle
                checked={user?.notify_run_failure ?? false}
                onChange={handleToggleNotifyRunFailure}
                label="Run failures"
              />
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Weekly summary</div>
                <div className={styles.rowHint}>
                  Usage and top prompts, sent weekly by the server&apos;s scheduled job.
                </div>
              </div>
              <Toggle
                checked={user?.notify_weekly_summary ?? false}
                onChange={handleToggleNotifyWeeklySummary}
                label="Weekly summary"
              />
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Evaluation complete</div>
                <div className={styles.rowHint}>Confirm when an eval run finishes scoring</div>
              </div>
              <Toggle
                checked={user?.notify_eval_complete ?? false}
                onChange={handleToggleNotifyEvalComplete}
                label="Evaluation complete"
              />
            </div>

            <div className={styles.divider} />

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Score regression</div>
                <div className={styles.rowHint}>
                  Alert me if a new eval run scores lower than the last one
                </div>
              </div>
              <Toggle
                checked={user?.notify_eval_regression ?? false}
                onChange={handleToggleNotifyEvalRegression}
                label="Score regression"
              />
            </div>
          </Card>
        </section>

        <section className={styles.section} id="s-api">
          <h2 className={styles.sectionLabel}>API access</h2>
          <Card className={styles.card}>
            <LLMConnectionForm />
          </Card>
        </section>

        <section className={styles.section} id="s-data">
          <h2 className={styles.sectionLabel}>Data</h2>
          <Card className={styles.card}>
            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Export all prompts</div>
                <div className={styles.rowHint}>
                  Download every saved prompt and its version history as JSON
                </div>
              </div>
              <Button
                variant="secondary"
                className={styles.iconButton}
                onClick={handleExport}
                disabled={isExporting}
              >
                <DownloadIcon size={16} tone="inherit" />
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            </div>
            {exportError && <div className={styles.error}>{exportError}</div>}
            {exportSuccess && <div className={styles.success}>{exportSuccess}</div>}
          </Card>
        </section>

        <section className={styles.section} id="s-danger">
          <h2 className={styles.sectionLabelDanger}>
            <DangerIcon size={16} tone="inherit" />
            Danger zone
          </h2>
          <Card className={styles.dangerCard}>
            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>Delete account</div>
                <div className={styles.rowHint}>
                  Permanently remove your account and all saved prompts. This can&apos;t be undone.
                </div>
              </div>
              <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                Delete account
              </Button>
            </div>
            {showDeleteConfirm && (
              <div className={styles.confirmBanner}>
                <p>Are you sure? This cannot be undone.</p>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Confirm your password"
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
                    {isDeleting ? 'Deleting…' : 'Yes, delete my account'}
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
          </Card>
        </section>
      </div>
    </div>
  );
}
