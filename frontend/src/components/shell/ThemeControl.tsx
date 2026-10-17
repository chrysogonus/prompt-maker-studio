'use client';

import { useSyncExternalStore } from 'react';
import { readStoredTheme, setTheme, subscribeTheme, type Theme } from '@/lib/theme';
import styles from './Sidebar.module.css';

export default function ThemeControl() {
  const theme = useSyncExternalStore(subscribeTheme, readStoredTheme, () => 'light' as Theme);
  return <label className={styles.theme}>
    <span>Theme</span>
    <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
      <option value="system">System</option>
    </select>
  </label>;
}
