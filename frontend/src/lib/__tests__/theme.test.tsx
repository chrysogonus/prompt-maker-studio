import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import ThemeControl from '@/components/shell/ThemeControl';
import ThemeSync from '@/components/ui/ThemeSync';
import { THEME_SCRIPT, isPublicPath } from '../theme';

let pathname = '/library';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let mediaChanged: () => void;

beforeEach(() => {
  localStorage.clear();
  mediaChanged = () => {};
  media = { matches: true, addEventListener: vi.fn((_event, listener) => { mediaChanged = listener; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  document.documentElement.dataset.theme = 'light';
  pathname = '/library';
  window.history.replaceState(null, '', '/library');
});

it('applies stored choices before paint while keeping light as the default', () => {
  for (const [stored, expected] of [[null, 'light'], ['dark', 'dark'], ['light', 'light'], ['system', 'dark']]) {
    if (stored === null) localStorage.removeItem('theme');
    else localStorage.setItem('theme', stored);
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe(expected);
  }
});

it('lets public pages follow the system when no theme was chosen, but not the app', () => {
  expect(['/', '/guides', '/tools/prompt-diff', '/gallery/meal-plan', '/terms'].every(isPublicPath)).toBe(true);
  expect(['/library', '/editor/new', '/settings', '/toolsy', '/oauth/authorize'].some(isPublicPath)).toBe(false);
  for (const [path, stored, expected] of [
    ['/tools', null, 'dark'], ['/tools', 'light', 'light'], ['/library', null, 'light'], ['/library', 'system', 'dark'],
  ] as const) {
    window.history.replaceState(null, '', path);
    if (stored === null) localStorage.removeItem('theme');
    else localStorage.setItem('theme', stored);
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme, `${path} ${stored}`).toBe(expected);
  }
});

it('re-applies the default when navigating from a public page into the app', () => {
  window.history.replaceState(null, '', '/gallery');
  pathname = '/gallery';
  const view = render(<ThemeSync />);
  expect(document.documentElement.dataset.theme).toBe('dark');
  window.history.replaceState(null, '', '/library');
  pathname = '/library';
  view.rerender(<ThemeSync />);
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('keeps theme controls synchronized and follows changes from another tab', async () => {
  render(<><ThemeControl /><ThemeControl /></>);
  const controls = screen.getAllByRole('combobox', { name: 'Theme' });
  await userEvent.selectOptions(controls[0], 'dark');
  expect(controls[1]).toHaveValue('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  act(() => {
    localStorage.setItem('theme', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));
  });
  expect(controls[0]).toHaveValue('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('follows system changes on public pages and removes its listener on unmount', () => {
  localStorage.setItem('theme', 'system');
  const view = render(<ThemeSync />);
  mediaChanged();
  expect(document.documentElement.dataset.theme).toBe('dark');
  media.matches = false;
  mediaChanged();
  expect(document.documentElement.dataset.theme).toBe('light');
  view.unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
});
