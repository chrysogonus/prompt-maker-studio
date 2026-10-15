'use client';

import { ProfileSettings } from './ProfileSettings';
import { SecuritySettings } from './SecuritySettings';
import { PreferencesSettings } from './PreferencesSettings';
import { ConnectionSettings } from './ConnectionSettings';
import { ExportSettings } from './ExportSettings';
import { DeleteAccountSettings } from './DeleteAccountSettings';

import styles from './SettingsPage.module.css';

import { useSettings } from './useSettings';

export default function SettingsPage() {
  const settings = useSettings();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <nav className={styles.sectionNav} aria-label="Settings sections">
        {[['profile', 'Profile'], ['security', 'Password and sessions'], ['preferences', 'Appearance and library'], ['api', 'AI connection'], ['data', 'Your data'], ['danger', 'Delete account']].map(([id, label]) => (
          <a key={id} href={`#s-${id}`}>{label}</a>
        ))}
      </nav>

      <ProfileSettings
        currentUser={settings.currentUser}
        user={settings.user}
        showUsernameEdit={settings.showUsernameEdit}
        setShowUsernameEdit={settings.setShowUsernameEdit}
        newUsernameValue={settings.newUsernameValue}
        setNewUsernameValue={settings.setNewUsernameValue}
        usernameError={settings.usernameError}
        setUsernameError={settings.setUsernameError}
        showEmailEdit={settings.showEmailEdit}
        setShowEmailEdit={settings.setShowEmailEdit}
        newEmailValue={settings.newEmailValue}
        setNewEmailValue={settings.setNewEmailValue}
        emailPassword={settings.emailPassword}
        setEmailPassword={settings.setEmailPassword}
        emailError={settings.emailError}
        setEmailError={settings.setEmailError}
        handleUsernameChange={settings.handleUsernameChange}
        handleEmailChange={settings.handleEmailChange}
      />

      <SecuritySettings
        isSigningOutEverywhere={settings.isSigningOutEverywhere}
        signOutError={settings.signOutError}
        handleSignOutEverywhere={settings.handleSignOutEverywhere}
      />

      <PreferencesSettings
        user={settings.user}
        theme={settings.theme}
        viewSave={settings.viewSave}
        prefsError={settings.prefsError}
        toggleTheme={settings.toggleTheme}
        handleDefaultLibraryViewChange={settings.handleDefaultLibraryViewChange}
      />

      <ConnectionSettings />

      <ExportSettings
        isExporting={settings.isExporting}
        exportError={settings.exportError}
        exportSuccess={settings.exportSuccess}
        handleExport={settings.handleExport}
      />

      <DeleteAccountSettings
        showDeleteConfirm={settings.showDeleteConfirm}
        setShowDeleteConfirm={settings.setShowDeleteConfirm}
        isDeleting={settings.isDeleting}
        deletePassword={settings.deletePassword}
        setDeletePassword={settings.setDeletePassword}
        deleteError={settings.deleteError}
        handleDeleteAccount={settings.handleDeleteAccount}
        closeDeleteConfirm={settings.closeDeleteConfirm}
      />
    </div>
  );
}
