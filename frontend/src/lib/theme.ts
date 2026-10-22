export type Theme = 'light' | 'dark' | 'system';

// Signed-out pages: a visitor who never chose a theme gets their system's. The app stays light.
const PUBLIC_PATH = /^\/(?:$|(?:guides|tools|gallery|impressum|datenschutz|terms)(?:\/|$))/;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('theme');
  return stored === 'dark' || stored === 'system' ? stored : 'light';
}

/** Apply the stored choice, or this page's default when there is none. */
export function applyTheme() {
  const stored = localStorage.getItem('theme');
  const followSystem = stored === 'system' || (stored === null && isPublicPath(window.location.pathname));
  document.documentElement.dataset.theme = stored === 'dark'
    || (followSystem && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  localStorage.setItem('theme', theme);
  applyTheme();
  window.dispatchEvent(new Event('themechange'));
}

export function subscribeTheme(onChange: () => void) {
  const update = () => { applyTheme(); onChange(); };
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
  `try{var t=localStorage.getItem('theme'),s=t==='system'||(t===null&&${PUBLIC_PATH}.test(location.pathname));document.documentElement.dataset.theme=t==='dark'||(s&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}`;
