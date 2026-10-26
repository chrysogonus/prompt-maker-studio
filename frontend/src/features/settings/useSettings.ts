'use client';

import { useState, useEffect, useRef, useSyncExternalStore, FormEvent } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthService } from '@/lib/auth';
import { usernamePolicyError } from '@/features/auth/usernamePolicy';
import { ApiClient } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { User, UserUpdate } from '@/types/auth';

import { APP_SLUG, pageTitle } from '@/lib/branding';
import { PreferenceSaveStatus } from './settingsState';
import { readStoredTheme, setTheme, subscribeTheme, type Theme } from '@/lib/theme';

export function useSettings() {
  const { currentUser, logout, setCurrentUser } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, readStoredTheme, () => 'light' as Theme);
  const [viewSave, setViewSave] = useState<PreferenceSaveStatus | null>(null);
  const [showUsernameEdit, setShowUsernameEdit] = useState(false);
  const [newUsernameValue, setNewUsernameValue] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [showEmailEdit, setShowEmailEdit] = useState(false);
  const [newEmailValue, setNewEmailValue] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
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

  const toggleTheme = setTheme;

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
    const policyError = usernamePolicyError(trimmed);
    if (policyError) {
      setUsernameError(policyError);
      return;
    }
    setUsernameError('');
    try {
      const updated = await AuthService.updateProfile({ new_username: trimmed });
      setUser(updated);
      setCurrentUser(updated.username);
      setShowUsernameEdit(false);
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
    if (!emailPassword) {
      setEmailError('Enter your current password to change your email.');
      return;
    }
    setEmailError('');
    try {
      const updated = await AuthService.updateProfile({
        email: trimmed,
        current_password: emailPassword,
      });
      setUser(updated);
      setEmailPassword('');
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
      AuthService.setSignInNotice('Your account and all its prompts were deleted.');
      window.history.replaceState(null, '', '/library');
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
  return {
    currentUser,
    user,
    theme,
    viewSave,
    showUsernameEdit,
    setShowUsernameEdit,
    newUsernameValue,
    setNewUsernameValue,
    usernameError,
    setUsernameError,
    showEmailEdit,
    setShowEmailEdit,
    newEmailValue,
    setNewEmailValue,
    emailPassword,
    setEmailPassword,
    emailError,
    setEmailError,
    prefsError,
    isExporting,
    exportError,
    exportSuccess,
    showDeleteConfirm,
    setShowDeleteConfirm,
    isDeleting,
    deletePassword,
    setDeletePassword,
    isSigningOutEverywhere,
    signOutError,
    deleteError,
    toggleTheme,
    handleUsernameChange,
    handleEmailChange,
    handleDefaultLibraryViewChange,
    handleExport,
    handleSignOutEverywhere,
    handleDeleteAccount,
    closeDeleteConfirm,
  };
}
