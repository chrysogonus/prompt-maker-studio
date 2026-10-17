export type Theme = 'light' | 'dark' | 'system';

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('theme');
  return stored === 'dark' || stored === 'system' ? stored : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
}

export function setTheme(theme: Theme) {
  localStorage.setItem('theme', theme);
  applyTheme(theme);
  window.dispatchEvent(new Event('themechange'));
}

export function subscribeTheme(onChange: () => void) {
  const update = () => { applyTheme(readStoredTheme()); onChange(); };
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  window.addEventListener('storage', update);
  window.addEventListener('themechange', update);
  return () => {
    media.removeEventListener('change', update);
    window.removeEventListener('storage', update);
    window.removeEventListener('themechange', update);
  };
}

export const THEME_SCRIPT =
  "try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}";
