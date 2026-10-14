import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../Sidebar';
import { ApiClient } from '@/lib/api';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import type { PromptHistoryResponse } from '@/types/prompt';

import { LibraryDataProvider } from '@/features/library/LibraryData';
import type { ReactElement } from 'react';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: LibraryDataProvider });

let pathname = '/library';
let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => params,
}));

vi.mock('@/lib/api', () => ({
  ApiClient: { getSavedPrompts: vi.fn() },
}));

const logout = vi.fn();
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ currentUser: 'alex', logout }),
}));

function prompt(id: number, folder: string | null, isFavorite = false): PromptHistoryResponse {
  return {
    id,
    name: `Prompt ${id}`,
    fields: [],
    generated_prompt: '',
    created_at: '2026-07-01T00:00:00',
    folder,
    is_favorite: isFavorite,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pathname = '/library';
  params = new URLSearchParams();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
    prompt(1, 'Work', true),
    prompt(2, 'Work'),
    prompt(3, 'Recovered history'),
    prompt(4, 'Learning'),
    prompt(5, null),
  ]);
});

function navLabels() {
  return within(screen.getByRole('navigation', { name: 'Library' }))
    .getAllByRole('link')
    .map((link) => link.textContent);
}

describe('Sidebar', () => {
  it('hides the closed mobile drawer, traps open focus, closes on Escape and restores the trigger', async () => {
    const user = userEvent.setup();
    let resize: () => void = () => {};
    const media = { matches: true, addEventListener: vi.fn((_event, listener) => { resize = listener; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
    const onNavigate = vi.fn();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(<Sidebar open={false} onNavigate={onNavigate} />);
    expect(screen.queryByRole('navigation', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sidebar')).toHaveAttribute('inert');
    view.rerender(<Sidebar open onNavigate={onNavigate} />);
    const drawer = screen.getByRole('dialog', { name: 'Sidebar' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    const first = within(drawer).getAllByRole('link')[0];
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    view.rerender(<Sidebar open={false} onNavigate={onNavigate} />);
    expect(trigger).toHaveFocus();
    act(() => { media.matches = false; resize(); });
    expect(screen.getByRole('navigation', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sidebar')).not.toHaveAttribute('inert');
    trigger.remove();
  });

  it('lists the library views and folders with counts, Recovered history last', async () => {
    render(<Sidebar open={false} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('link', { name: /Work/ })).toHaveTextContent('Work2');
    expect(navLabels()).toEqual([
      'All prompts5',
      'Favorites1',
      'Learning1',
      'Work2',
      'Recovered history1',
      'Unfiled1',
    ]);
    expect(screen.getByRole('link', { name: /Learning/ })).toHaveAttribute(
      'href',
      '/library?folder=Learning',
    );
    expect(screen.getByRole('link', { name: 'New prompt' })).toHaveAttribute('href', '/editor/new');
  });

  it('marks the view being shown', async () => {
    params = new URLSearchParams({ folder: 'Work' });
    render(<Sidebar open={false} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('link', { name: /Work/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /All prompts/ })).not.toHaveAttribute('aria-current');
  });

  it('marks Settings while on the settings page', async () => {
    pathname = '/settings';
    render(<Sidebar open={false} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /All prompts/ })).not.toHaveAttribute('aria-current');
  });

  it('refreshes its counts when the library changes', async () => {
    render(<Sidebar open={false} onNavigate={vi.fn()} />);
    await screen.findByRole('link', { name: /Work/ });

    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([prompt(1, 'Writing')]);
    await act(async () => notifyLibraryChanged());

    expect(await screen.findByRole('link', { name: /Writing/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Work/ })).not.toBeInTheDocument();
  });

  it('closes the phone drawer on navigation and signs out', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Sidebar open onNavigate={onNavigate} />);
    await screen.findByRole('link', { name: /Work/ });

    await user.click(screen.getByRole('link', { name: /Favorites/ }));
    expect(onNavigate).toHaveBeenCalled();

    expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });
});
