'use client';

import { useSyncExternalStore } from 'react';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { readStoredTheme, setTheme, subscribeTheme, type Theme } from '@/lib/theme';
import styles from './Sidebar.module.css';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

// The same control as Settings → Appearance, without the icons the sidebar has no room for.
export default function ThemeControl() {
  const theme = useSyncExternalStore(subscribeTheme, readStoredTheme, () => 'light' as Theme);
  return <div className={styles.theme}>
    <SegmentedControl aria-label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
  </div>;
}
