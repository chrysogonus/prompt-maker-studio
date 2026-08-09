import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expectConsoleError } from '@/test/setup';
import userEvent from '@testing-library/user-event';
import LibraryPage from '../page';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';

let currentParams = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn((url: string) => {
  const queryIndex = url.indexOf('?');
  const search = queryIndex !== -1 ? url.slice(queryIndex) : '';
  currentParams = new URLSearchParams(search);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentParams,
  usePathname: () => '/library',
}));

vi.mock('@/lib/api', () => ({
  ApiClient: {
    getSavedPrompts: vi.fn(),
    getTags: vi.fn(),
    getHistory: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    flushDeletePrompt: vi.fn(),
    duplicatePrompt: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  AuthService: {
    getCurrentUser: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

// Supplied by `(app)/layout.tsx` in the real app; the "New prompt" link uses it
// to clear that user's draft.
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ currentUser: 'alex', logout: vi.fn() }),
}));

function savedPrompt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Customer Support Triage',
    fields: [{ name: 'goal', content: 'triage tickets' }],
    generated_prompt: '<GOAL>triage tickets</GOAL>',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    folder: 'Support',
    is_favorite: false,
    tags: ['gpt-4o', 'customer-facing'],
    run_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  currentParams = new URLSearchParams();
  vi.resetAllMocks();
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([savedPrompt()]);
  vi.mocked(ApiClient.getTags).mockResolvedValue(['gpt-4o', 'customer-facing']);
  vi.mocked(ApiClient.getHistory).mockResolvedValue([]);
  vi.mocked(ApiClient.updatePrompt).mockResolvedValue(savedPrompt());
  vi.mocked(ApiClient.deletePrompt).mockResolvedValue(undefined);
  vi.mocked(AuthService.getCurrentUser).mockRejectedValue(new Error('not authenticated in test'));
  vi.mocked(AuthService.updateProfile).mockResolvedValue({
    id: 1,
    username: 'testuser',
    created_at: '2026-07-01T00:00:00Z',
    default_library_view: 'grid',
  });
});

describe('LibraryPage', () => {
  it('renders saved prompts as cards by default', async () => {
    render(<LibraryPage />);
    expect(await screen.findByText('Customer Support Triage')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0);
  });

  it('renders card titles as h2 so heading levels stay sequential under the page h1', async () => {
    render(<LibraryPage />);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Customer Support Triage' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Prompt library' })).toBeInTheDocument();
  });

  it('never presents a failed saved-prompts request as an empty library', async () => {
    // The request is made to fail on purpose; the page logs it.
    expectConsoleError('Failed to load saved prompts:');
    vi.mocked(ApiClient.getSavedPrompts).mockRejectedValue(new Error('network unavailable'));
    render(<LibraryPage />);

    expect(await screen.findByText(/Your prompts have not been deleted/)).toBeInTheDocument();
    expect(screen.queryByText('No saved prompts yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Saved/ })).toHaveTextContent('Saved (!)');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('filters saved prompts by tag without hiding the total count', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
      savedPrompt(),
      savedPrompt({ id: 2, name: 'Engineering Prompt', tags: ['engineering'] }),
    ]);
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'customer-facing' });

    await userEvent.click(screen.getByRole('button', { name: 'customer-facing' }));

    expect(screen.getByText('Customer Support Triage')).toBeInTheDocument();
    expect(screen.queryByText('Engineering Prompt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Saved/ })).toHaveTextContent('1 / 2');
    expect(ApiClient.getSavedPrompts).toHaveBeenCalledTimes(1);
  });

  it('shows the real Playground run count instead of a placeholder', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([savedPrompt({ run_count: 7 })]);
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    expect(screen.getByText('7 runs')).toBeInTheDocument();
    expect(screen.queryByText('— runs')).not.toBeInTheDocument();
  });

  it('uses the singular label for one Playground run', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([savedPrompt({ run_count: 1 })]);
    render(<LibraryPage />);

    expect(await screen.findByText('1 run')).toBeInTheDocument();
    expect(screen.queryByText('1 runs')).not.toBeInTheDocument();
  });

  it('navigates to the editor when a card is clicked', async () => {
    render(<LibraryPage />);
    const card = await screen.findByText('Customer Support Triage');
    await userEvent.click(card);
    expect(push).toHaveBeenCalledWith('/editor/1');
  });

  it('filters the visible cards by the search box', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
      savedPrompt({ id: 1, name: 'Customer Support Triage' }),
      savedPrompt({ id: 2, name: 'SQL Query Generator', folder: 'Engineering', tags: [] }),
    ]);
    render(<LibraryPage />);
    await screen.findByText('SQL Query Generator');

    await userEvent.type(screen.getByLabelText('Filter saved prompts'), 'SQL');

    expect(screen.getByText('SQL Query Generator')).toBeInTheDocument();
    expect(screen.queryByText('Customer Support Triage')).not.toBeInTheDocument();
  });

  it('shows active tag filters and clears them', async () => {
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.click(screen.getByRole('button', { name: 'customer-facing' }));

    expect(screen.getByText('Tag: customer-facing')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('Tag: customer-facing')).not.toBeInTheDocument();
  });

  it('removes both filter params from the URL when Clear filters is clicked', async () => {
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.type(screen.getByLabelText('Filter saved prompts'), 'triage');
    await userEvent.click(screen.getByRole('button', { name: 'customer-facing' }));
    expect(currentParams.get('q')).toBe('triage');
    expect(currentParams.get('tag')).toBe('customer-facing');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(currentParams.get('q')).toBeNull();
    expect(currentParams.get('tag')).toBeNull();
  });

  it('matches search text against prompt body content, not just the title', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
      savedPrompt({
        id: 1,
        name: 'Code Review Checklist',
        generated_prompt: '<GOAL>review python code</GOAL>',
        tags: [],
      }),
      savedPrompt({ id: 2, name: 'SQL Query Generator', folder: 'Engineering', tags: [] }),
    ]);
    render(<LibraryPage />);
    await screen.findByText('SQL Query Generator');

    await userEvent.type(screen.getByLabelText('Filter saved prompts'), 'python');

    expect(screen.getByText('Code Review Checklist')).toBeInTheDocument();
    expect(screen.queryByText('SQL Query Generator')).not.toBeInTheDocument();
  });

  it('toggles favorite via the star button without navigating', async () => {
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(savedPrompt({ is_favorite: true }));
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.click(screen.getByRole('button', { name: /favorite customer support triage/i }));

    // No `last_updated_at`: favouriting is last-writer-wins metadata, and the
    // star has no in-flight guard, so sending one would reject a double-click
    // as a conflict the user caused themselves.
    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, {
      is_favorite: true,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('does not reject a double-clicked favorite as a conflict', async () => {
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(savedPrompt({ is_favorite: true }));
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    const star = screen.getByRole('button', { name: /favorite customer support triage/i });
    await userEvent.click(star);
    await userEvent.click(star);

    // Both mutations are stamp-free, so neither can be refused for a conflict
    // against the other.
    for (const call of vi.mocked(ApiClient.updatePrompt).mock.calls) {
      expect(call[1]).not.toHaveProperty('last_updated_at');
    }
    expect(screen.queryByText(/failed to update favorite/i)).not.toBeInTheDocument();
  });

  it('opens a saved prompt from the list view via the keyboard (Enter)', async () => {
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    const row = await screen.findByText('Customer Support Triage');
    const listRow = row.closest('[role="group"]') as HTMLElement;
    expect(listRow).toBeInTheDocument();

    listRow.focus();
    await userEvent.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/editor/1');
  });

  it('does not navigate when Enter is pressed on a nested action inside a list row', async () => {
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    await screen.findByText('Customer Support Triage');

    screen.getByRole('button', { name: /favorite customer support triage/i }).focus();
    await userEvent.keyboard('{Enter}');

    expect(push).not.toHaveBeenCalled();
  });

  it('switches to list view and persists the choice to the user profile', async () => {
    vi.mocked(AuthService.updateProfile).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      default_library_view: 'list',
    });
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.click(screen.getByRole('radio', { name: 'List' }));

    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(AuthService.updateProfile).toHaveBeenCalledWith({ default_library_view: 'list' });
    });
  });

  it('rolls the view toggle back when its preference cannot be saved', async () => {
    vi.mocked(AuthService.updateProfile).mockRejectedValue(new Error('Preference unavailable'));
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.click(screen.getByRole('radio', { name: 'List' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Preference unavailable');
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  });

  it('defaults to the list view when the user has that preference set', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'testuser',
      created_at: '2026-07-01T00:00:00Z',
      default_library_view: 'list',
    });
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('shows history items on the History tab', async () => {
    vi.mocked(ApiClient.getHistory).mockResolvedValue([
      {
        id: 9,
        name: null,
        fields: [{ name: 'goal', content: 'x' }],
        generated_prompt: '<GOAL>x</GOAL>',
        created_at: '2026-07-01T00:00:00Z',
        run_count: 0,
      },
    ]);
    render(<LibraryPage />);
    await screen.findByText('Customer Support Triage');

    await userEvent.click(screen.getByRole('button', { name: /^history$/i }));

    expect(await screen.findByText('x')).toBeInTheDocument();
  });

  it('requires an ID-bound confirmation and offers undo before deleting', async () => {
    vi.mocked(ApiClient.deletePrompt).mockResolvedValue(undefined);
    render(<LibraryPage />);
    const card = (await screen.findByText('Customer Support Triage')).closest('div')!
      .parentElement as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: /^Delete / }));
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();
    expect(within(card).getByRole('button', { name: /^Confirm delete / })).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: /^Confirm delete / }));
    await waitFor(() => {
      expect(screen.queryByText('Customer Support Triage')).not.toBeInTheDocument();
    });
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Customer Support Triage')).toBeInTheDocument();
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();
  });

  it('duplicates without navigating and offers an Open copy action', async () => {
    vi.mocked(ApiClient.duplicatePrompt).mockResolvedValue(
      savedPrompt({ id: 2, name: 'Customer Support Triage Duplicate' }),
    );
    render(<LibraryPage />);
    const card = (await screen.findByText('Customer Support Triage')).closest('div')!
      .parentElement as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: /^Duplicate / }));

    expect(await screen.findByText('Customer Support Triage Duplicate')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Open copy' }));
    expect(push).toHaveBeenCalledWith('/editor/2');
  });

  it('renames a prompt and warns, without blocking, when the new name collides with another prompt', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
      savedPrompt(),
      savedPrompt({ id: 2, name: 'Other Prompt' }),
    ]);
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(
      savedPrompt({ id: 2, name: 'customer support triage' }),
    );
    render(<LibraryPage />);
    const card = (await screen.findByText('Other Prompt')).closest('[role="group"]') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: /^Rename / }));
    const input = within(card).getByRole('textbox');
    await userEvent.clear(input);
    // Case-insensitive collision with the existing "Customer Support Triage".
    await userEvent.type(input, 'customer support triage{Enter}');

    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ name: 'customer support triage' }),
    );
    expect(
      await screen.findByText(
        'Renamed to “customer support triage”. Another prompt already uses this name.',
      ),
    ).toBeInTheDocument();
  });

  it('removes Undo when deletion commits and auto-dismisses the final toast', async () => {
    render(<LibraryPage />);
    const card = (await screen.findByText('Customer Support Triage')).closest('div')!
      .parentElement as HTMLElement;
    vi.useFakeTimers();

    fireEvent.click(within(card).getByRole('button', { name: /^Delete / }));
    fireEvent.click(within(card).getByRole('button', { name: /^Confirm delete / }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(ApiClient.deletePrompt).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByText('Customer Support Triage deleted.')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(screen.queryByText('Customer Support Triage deleted.')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('restores the prompt and surfaces an error when the server rejects the delete', async () => {
    vi.mocked(ApiClient.deletePrompt).mockRejectedValue(
      new Error('Failed to delete prompt: 503'),
    );
    render(<LibraryPage />);
    const card = (await screen.findByText('Customer Support Triage')).closest('div')!
      .parentElement as HTMLElement;
    vi.useFakeTimers();

    fireEvent.click(within(card).getByRole('button', { name: /^Delete / }));
    fireEvent.click(within(card).getByRole('button', { name: /^Confirm delete / }));
    expect(screen.queryByText('Customer Support Triage')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText('Customer Support Triage')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to delete prompt: 503');
    expect(screen.queryByText('Customer Support Triage deleted.')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('commits a pending delete via keepalive when the page unloads mid-undo-window', async () => {
    render(<LibraryPage />);
    const card = (await screen.findByText('Customer Support Triage')).closest('div')!
      .parentElement as HTMLElement;
    vi.useFakeTimers();

    fireEvent.click(within(card).getByRole('button', { name: /^Delete / }));
    fireEvent.click(within(card).getByRole('button', { name: /^Confirm delete / }));

    fireEvent(window, new Event('pagehide'));
    expect(ApiClient.flushDeletePrompt).toHaveBeenCalledWith(1);

    // The keepalive flush replaces the timed commit — no double delete.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('clears the signed-in user\'s new-prompt draft when starting a new prompt', async () => {
    // Regression: this key used to be built from an unawaited promise, giving
    // `draft:[object Promise]`, so the old draft survived into the new editor.
    localStorage.setItem('prompt-maker-studio:draft:alex', 'a stale draft');
    render(<LibraryPage />);
    await screen.findByRole('heading', { name: 'Prompt library' });

    await userEvent.click(screen.getByRole('link', { name: /New prompt/ }));

    expect(localStorage.getItem('prompt-maker-studio:draft:alex')).toBeNull();
  });
});
