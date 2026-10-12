import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LibraryPage from '../LibraryPage';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import type { PromptHistoryResponse } from '@/types/prompt';

import { LibraryDataProvider } from '@/features/library/LibraryData';
import type { ReactElement } from 'react';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: LibraryDataProvider });

let currentParams = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentParams,
}));

vi.mock('@/lib/api', () => ({
  ApiClient: {
    getSavedPrompts: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    flushDeletePrompt: vi.fn(),
    duplicatePrompt: vi.fn(),
    renameFolder: vi.fn(),
    removeFolder: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  AuthService: { getCurrentUser: vi.fn() },
}));

function saved(overrides: Partial<PromptHistoryResponse> = {}): PromptHistoryResponse {
  return {
    id: 1,
    name: 'Weekly status update',
    fields: [
      { name: 'Notes', content: '{{notes}}' },
      { name: 'Task', content: 'Turn the notes from {{team}} into a status update.' },
    ],
    generated_prompt: '<NOTES>\n{{notes}}\n</NOTES>\n\n<TASK>\nTurn the notes…\n</TASK>',
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-08T00:00:00',
    folder: 'Work',
    is_favorite: false,
    variable_metadata: null,
    ...overrides,
  };
}

const LIBRARY = [
  saved(),
  saved({
    id: 2,
    name: 'Reply to a tricky email',
    fields: [{ name: 'Role', content: 'You write warm but firm emails.' }],
    folder: 'Writing',
    is_favorite: true,
    updated_at: '2026-07-09T00:00:00',
  }),
  saved({
    id: 3,
    name: 'LinkedIn post',
    fields: [{ name: 'Task', content: 'Turn my notes into a post.' }],
    folder: null,
    updated_at: '2026-07-02T00:00:00',
  }),
  saved({
    id: 4,
    name: 'Untitled (14 Mar 2026, 09:12 UTC)',
    fields: [{ name: 'task', content: 'A birthday message' }],
    folder: 'Recovered history',
    updated_at: '2026-03-14T09:12:00',
  }),
];

function rowNames() {
  return screen.getAllByRole('listitem').map((item) => within(item).getAllByRole('link')[0].textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue(LIBRARY);
  vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
    id: 1,
    username: 'alex',
    created_at: '2026-01-01T00:00:00Z',
    default_library_view: 'list',
  });
});

async function renderLibrary(params = '') {
  currentParams = new URLSearchParams(params);
  const view = render(<LibraryPage />);
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => expect(screen.queryByText('Loading your prompts…')).not.toBeInTheDocument());
  return view;
}

describe('LibraryPage', () => {
  it('lists every prompt, most recently edited first, with its folder and variables', async () => {
    await renderLibrary();

    expect(screen.getByRole('heading', { name: 'All prompts' })).toBeInTheDocument();
    expect(rowNames()).toEqual([
      'Reply to a tricky email',
      'Weekly status update',
      'LinkedIn post',
      'Untitled (14 Mar 2026, 09:12 UTC)',
    ]);
    const weekly = screen.getAllByRole('listitem')[1];
    expect(within(weekly).getByText('Work')).toBeInTheDocument();
    expect(within(weekly).getByText('2 variables')).toBeInTheDocument();
    // The excerpt skips a section that is only a variable.
    expect(within(weekly).getByText(/Turn the notes from/)).toBeInTheDocument();
  });

  it.each([
    ['view=favorites', 'Favorites', ['Reply to a tricky email']],
    ['view=unfiled', 'Unfiled', ['LinkedIn post']],
    ['folder=Work', 'Work', ['Weekly status update']],
  ])('narrows to %s', async (params, title, names) => {
    await renderLibrary(params);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(rowNames()).toEqual(names);
  });

  it('explains the Recovered history folder', async () => {
    await renderLibrary('folder=Recovered history');

    expect(screen.getByText(/unnamed prompts from your old generation history/)).toBeInTheDocument();
  });

  it('searches names, folders and section text, and can clear a search with no results', async () => {
    const user = userEvent.setup();
    await renderLibrary();

    await user.type(screen.getByLabelText('Search prompts'), 'firm emails');
    expect(rowNames()).toEqual(['Reply to a tricky email']);
    expect(screen.getByText('1 of 4')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search prompts'));
    await user.type(screen.getByLabelText('Search prompts'), 'nothing like this');
    expect(screen.getByText('No prompts match “nothing like this”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(rowNames()).toHaveLength(4);
  });

  it('stars a prompt', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(saved({ is_favorite: true }));
    await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'Add Weekly status update to favorites' }));

    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, { is_favorite: true });
    expect(
      await screen.findByRole('button', { name: 'Remove Weekly status update from favorites' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('copies a template in one click', async () => {
    const user = userEvent.setup();
    await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'Copy the Weekly status update template' }));

    expect(await navigator.clipboard.readText()).toBe(LIBRARY[0].generated_prompt);
    expect(screen.getByText('Copied the “Weekly status update” template')).toBeInTheDocument();
  });

  it('deletes with an undo, and only tells the server once the undo window has passed', async () => {
    const user = userEvent.setup();
    const view = await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'More actions for LinkedIn post' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(rowNames()).not.toContain('LinkedIn post');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(rowNames()).toContain('LinkedIn post');
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More actions for LinkedIn post' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    // Leaving before the window closes still sends the delete.
    view.unmount();
    expect(ApiClient.flushDeletePrompt).toHaveBeenCalledWith(3);
  });

  it('renames a prompt in place', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(saved({ name: 'Status update' }));
    await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'More actions for Weekly status update' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Prompt name');
    await user.clear(input);
    await user.type(input, 'Status update{Enter}');

    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, { name: 'Status update' });
    expect(await screen.findByRole('link', { name: 'Status update' })).toBeInTheDocument();
  });

  it('moves a prompt to another folder', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(saved({ id: 3, folder: 'Writing' }));
    await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'More actions for LinkedIn post' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move to folder…' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to folder' });
    await user.type(within(dialog).getByLabelText('Folder'), 'Writing');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));

    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(3, { folder: 'Writing' });
    expect(await screen.findByText('Moved to Writing')).toBeInTheDocument();
  });

  it('duplicates a prompt and offers to open the copy', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.duplicatePrompt).mockResolvedValue(
      saved({ id: 9, name: 'Weekly status update Duplicate' }),
    );
    await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'More actions for Weekly status update' }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await user.click(await screen.findByRole('button', { name: 'Open copy' }));

    expect(push).toHaveBeenCalledWith('/editor/9');
  });

  it('renames a folder and follows it to its new name', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.renameFolder).mockResolvedValue({ name: 'Job', prompt_count: 1 });
    await renderLibrary('folder=Work');

    await user.click(screen.getByRole('button', { name: 'Actions for the Work folder' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename folder' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename folder' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Job');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(ApiClient.renameFolder).toHaveBeenCalledWith('Work', 'Job'));
    expect(replace).toHaveBeenCalledWith('/library?folder=Job');
  });

  it('removes a folder without deleting its prompts', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.removeFolder).mockResolvedValue({ name: 'Work', prompt_count: 1 });
    await renderLibrary('folder=Work');

    await user.click(screen.getByRole('button', { name: 'Actions for the Work folder' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove folder…' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove “Work”?' });
    expect(within(dialog).getByText(/will move to Unfiled. No prompts are deleted/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove folder' }));

    await waitFor(() => expect(ApiClient.removeFolder).toHaveBeenCalledWith('Work'));
    expect(replace).toHaveBeenCalledWith('/library?view=unfiled');
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();
  });

  it('opens in the layout chosen in Settings', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
      id: 1,
      username: 'alex',
      created_at: '2026-01-01T00:00:00Z',
      default_library_view: 'grid',
    });
    await renderLibrary();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('invites a first prompt when the library is empty', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([]);
    await renderLibrary();

    expect(screen.getByRole('heading', { name: 'Your prompt library is empty' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Paste a prompt' })).toHaveAttribute('href', '/editor/new?import=1');
    expect(screen.getByRole('link', { name: /Rewrite my text/ })).toHaveAttribute(
      'href',
      '/editor/new?starter=rewrite',
    );
  });

  it('says when the library could not be loaded and retries', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getSavedPrompts).mockRejectedValueOnce(new Error('Network down'));
    await renderLibrary();

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'LinkedIn post' })).toBeInTheDocument();
  });
});
