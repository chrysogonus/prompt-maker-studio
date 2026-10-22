'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applyTheme, subscribeTheme } from '@/lib/theme';

/** Keep a system preference current, and re-apply when navigating between public pages and the app. */
export default function ThemeSync() {
  const pathname = usePathname();
  useEffect(() => { applyTheme(); }, [pathname]);
  useEffect(() => subscribeTheme(() => {}), []);
  return null;
}
