import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import ThemeControl from '@/components/shell/ThemeControl';
import ThemeSync from '@/components/ui/ThemeSync';
import { THEME_SCRIPT } from '../theme';

let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let mediaChanged: () => void;

beforeEach(() => {
  localStorage.clear();
  mediaChanged = () => {};
  media = { matches: true, addEventListener: vi.fn((_event, listener) => { mediaChanged = listener; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  document.documentElement.dataset.theme = 'light';
});

it('applies stored choices before paint while keeping light as the default', () => {
  for (const [stored, expected] of [[null, 'light'], ['dark', 'dark'], ['light', 'light'], ['system', 'dark']]) {
    if (stored === null) localStorage.removeItem('theme');
    else localStorage.setItem('theme', stored);
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe(expected);
  }
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
