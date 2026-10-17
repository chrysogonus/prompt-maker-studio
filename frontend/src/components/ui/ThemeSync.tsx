'use client';

import { useEffect } from 'react';
import { subscribeTheme } from '@/lib/theme';

/** Keep a system preference current on public routes as well as in the app. */
export default function ThemeSync() {
  useEffect(() => subscribeTheme(() => {}), []);
  return null;
}
