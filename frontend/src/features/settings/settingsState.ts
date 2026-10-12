export type Theme = 'light' | 'dark';

export type PreferenceSaveStatus = 'saving' | 'saved';

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}
