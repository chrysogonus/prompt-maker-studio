import SegmentedControl from '@/components/ui/SegmentedControl';
import {
  ActionCompleteIcon,
  DarkThemeIcon,
  GridViewIcon,
  LightThemeIcon,
  ListViewIcon,
  LoadingIcon,
} from '@/components/ui/icon';
import styles from './SettingsPage.module.css';
import type { useSettings } from './useSettings';
const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: <LightThemeIcon size={14} tone="inherit" /> },
  { value: 'dark', label: 'Dark', icon: <DarkThemeIcon size={14} tone="inherit" /> },
] as const;

const LIBRARY_VIEW_OPTIONS = [
  { value: 'list', label: 'List', icon: <ListViewIcon size={14} tone="inherit" /> },
  { value: 'grid', label: 'Grid', icon: <GridViewIcon size={14} tone="inherit" /> },
] as const;

type Props = Pick<
  ReturnType<typeof useSettings>,
  | 'user'
  | 'theme'
  | 'viewSave'
  | 'prefsError'
  | 'toggleTheme'
  | 'handleDefaultLibraryViewChange'
>;

export function PreferencesSettings({
  user,
  theme,
  viewSave,
  prefsError,
  toggleTheme,
  handleDefaultLibraryViewChange,
}: Props) {
  return (
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
  );
}
