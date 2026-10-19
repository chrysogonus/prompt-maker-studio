import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LibraryPage from '../LibraryPage';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import { pasteHandoffKey } from '@/lib/promptImport';
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
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    flushDeletePrompt: vi.fn(),
    duplicatePrompt: vi.fn(),
    renameFolder: vi.fn(),
    removeFolder: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  AuthService: { getCurrentUser: vi.fn(), updateProfile: vi.fn() },
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
  vi.resetAllMocks();
  currentParams = new URLSearchParams();
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue(LIBRARY);
  vi.mocked(AuthService.getCurrentUser).mockResolvedValue({
    id: 1,
    username: 'alex',
    created_at: '2026-01-01T00:00:00Z',
    default_library_view: 'list',
  });
  vi.mocked(AuthService.updateProfile).mockResolvedValue({ id: 1, username: 'alex', created_at: '2026-01-01T00:00:00Z' });
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

  it('matches every search word in any order, across title, folder and sections', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([
      saved({ id: 1, name: 'Refund Request Template', folder: 'Support', fields: [{ name: 'Task', content: 'Draft a refund confirmation email.' }] }),
      saved({ id: 2, name: 'Escalation Notice', folder: 'Support', fields: [{ name: 'Task', content: 'Escalate the ticket.' }] }),
    ]);
    const { container } = await renderLibrary();
    const search = screen.getByLabelText('Search prompts');
    await user.type(search, 'email refund');
    expect(rowNames()).toEqual(['Refund Request Template']);
    expect(container.querySelector('mark')).toHaveTextContent('email');
    await user.clear(search);
    await user.type(search, '  escalation   notice ');
    expect(rowNames()).toEqual(['Escalation Notice']);
    expect(container.querySelector('mark')).toHaveTextContent('Escalation Notice');
    await user.clear(search);
    await user.type(search, 'support ticket');
    expect(rowNames()).toEqual(['Escalation Notice']);
    await user.clear(search);
    await user.type(search, 'refund ticket');
    expect(screen.getByText('No prompts match “refund ticket”')).toBeInTheDocument();
  });

  it.each(['list', 'grid'])('shows matching context in %s and keeps the default excerpt without a query', async layout => {
    const user = userEvent.setup();
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({ id: 1, username: 'alex', created_at: '2026-01-01', default_library_view: layout as 'list' | 'grid' });
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([saved({ name: 'Café brief', folder: 'Résearch', fields: [
      { name: 'Format', content: 'Return bullet points.' },
      { name: 'Task', content: 'Long introduction. '.repeat(50) + 'Visit the cafe\u0301 tomorrow <script>alert(1)</script>.' },
    ] })]);
    const { container } = await renderLibrary();
    expect(screen.getByText(/^Long introduction\./)).toBeInTheDocument();
    const search = screen.getByLabelText('Search prompts');
    await user.type(search, 'tomorrow');
    expect(screen.getByText('Task:')).toBeInTheDocument();
    expect(container.querySelector('mark')).toHaveTextContent('tomorrow');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('mark')?.parentElement?.textContent?.length).toBeLessThan(190);
    await user.clear(search);
    await user.type(search, 'CAFÉ');
    expect(screen.getByText('Title:')).toBeInTheDocument();
    expect(container.querySelector('mark')).toHaveTextContent('Café');
    await user.clear(search);
    await user.type(search, 'research');
    expect(screen.getByText('Folder:')).toBeInTheDocument();
    expect(container.querySelector('mark')).toHaveTextContent('Résearch');
    await user.clear(search);
    await user.type(search, 'visit the café');
    expect(screen.getByText('Task:')).toBeInTheDocument();
    expect(container.querySelector('mark')).toHaveTextContent('Visit the cafe\u0301');
    await user.clear(search);
    expect(screen.getByText(/^Long introduction\./)).toBeInTheDocument();
    expect(container.querySelector('mark')).toBeNull();
  });

  it('shows the variable count and the task rather than the role on grid cards', async () => {
    vi.mocked(AuthService.getCurrentUser).mockResolvedValue({ id: 1, username: 'alex', created_at: '2026-01-01', default_library_view: 'grid' });
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([saved({ fields: [
      { name: 'Role', content: 'You are a helpful editor.' },
      { name: 'Task', content: 'Rewrite {{draft}} in a {{tone}} voice.' },
    ] })]);
    await renderLibrary();

    const card = screen.getByRole('listitem');
    expect(within(card).getByText('2 variables')).toBeInTheDocument();
    expect(card.querySelector('p')).toHaveTextContent('Rewrite {{draft}} in a {{tone}} voice.');
    expect(within(card).queryByText('You are a helpful editor.')).not.toBeInTheDocument();
  });

  it('previews a pasted note with an editable fallback title and preserves its content', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), 'A plain note\n## Existing heading\nKeep this.');
    await user.type(screen.getByLabelText('Title for a single note'), 'My note');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByLabelText('Title for prompt 1')).toHaveValue('My note');
    expect(screen.getByText('A plain note\n## Existing heading\nKeep this.', { collapseWhitespace: false })).toBeVisible();
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
  });

  it('keeps content recency order when favorites change organizational timestamps', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue(LIBRARY.map(prompt => ({ ...prompt, content_updated_at: prompt.updated_at })));
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(saved({ is_favorite: true, updated_at: '2026-10-17T12:00:00Z', content_updated_at: LIBRARY[0].updated_at }));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add Weekly status update to favorites' }));
    await screen.findByRole('button', { name: 'Remove Weekly status update from favorites' });
    expect(rowNames()[0]).toBe('Reply to a tricky email');
  });

  it('keeps a pending deletion hidden while importing and allows undo', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValue(saved({ id: 20, name: 'Greeting' }));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'More actions for LinkedIn post' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), '# Greeting\nHello');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Keep as written' }));
    await screen.findByText(/Imported 1 of 1 prompts/);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(rowNames()).not.toContain('LinkedIn post');
    expect(rowNames()).toContain('Greeting');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(rowNames()).toContain('LinkedIn post');
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();
  });

  it('keeps an empty-library import open after partial success so failures can be retried', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([]);
    vi.mocked(ApiClient.createPrompt).mockResolvedValueOnce(saved({ id: 20, name: 'First' })).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(saved({ id: 21, name: 'Second' }));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), '# First\nHello\n# Second\nThanks');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Import 2 prompts' }));
    await screen.findByText(/Imported 1 of 2 prompts/);
    expect(screen.getByLabelText('Title for prompt 1')).toHaveValue('Second');
    await user.click(screen.getByRole('button', { name: 'Import 1 prompt' }));
    await screen.findByText(/Imported 1 of 1 prompts/);
    expect(ApiClient.createPrompt).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(rowNames()).toContain('First');
    expect(rowNames()).toContain('Second');
  });

  it('rejects the whole invalid import before writes and validates edited titles', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    const input = screen.getByLabelText('Paste text');
    await user.type(input, '# Good\nOK\n# Bad\n## 123 invalid\nBad');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert')).toHaveTextContent('section names');
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '# Good\nOK');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.clear(screen.getByLabelText('Title for prompt 1'));
    await user.click(screen.getByRole('button', { name: 'Keep as written' }));
    expect(screen.getByRole('alert')).toHaveTextContent('title must contain');
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
  });

  it('lets users sort by title', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.selectOptions(screen.getByLabelText('Sort prompts'), 'title');
    expect(rowNames()).toEqual(['LinkedIn post', 'Reply to a tricky email', 'Untitled (14 Mar 2026, 09:12 UTC)', 'Weekly status update']);
  });

  it('files selected prompts and retains failures for retry', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValueOnce(saved({ folder: 'Team' })).mockRejectedValueOnce(new Error('Offline'));
    await renderLibrary();
    await user.click(screen.getByLabelText('Select Weekly status update'));
    await user.click(screen.getByLabelText('Select LinkedIn post'));
    await user.type(screen.getByLabelText('File selected in folder'), 'Team');
    await user.click(screen.getByRole('button', { name: 'Move selected' }));
    expect(await screen.findByText('Moved 1 of 2 prompts. 1 failed; still selected for retry.')).toBeInTheDocument();
    expect(screen.getByLabelText('Select LinkedIn post')).toBeChecked();
    expect(screen.getByLabelText('Select Weekly status update')).not.toBeChecked();
  });

  it('previews and edits imports before creating, and never repeats successful imports', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValueOnce(saved({ id: 20, name: 'Greeting' })).mockRejectedValueOnce(new Error('Offline'));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), '# Greeting\nHello\n# Reply\nThanks');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Folder for Greeting'), 'Team');
    await user.click(screen.getByRole('button', { name: 'Import 2 prompts' }));
    expect(await screen.findByText(/Imported 1 of 2 prompts/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Title for prompt 1')).toHaveValue('Reply');
    expect(ApiClient.createPrompt).toHaveBeenCalledWith({ name: 'Greeting', folder: 'Team', fields: [{ name: 'Prompt', content: 'Hello' }] });
  });

  it('opens imported prompts from the success step or imports more', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValueOnce(saved({ id: 20, name: 'First', folder: 'Team' })).mockResolvedValueOnce(saved({ id: 21, name: 'Second', folder: 'Team' }));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), '# First\nHello\n# Second\nThanks');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Thanks')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Import 2 prompts' }));
    await screen.findByText('Imported 2 of 2 prompts.');
    expect(screen.queryByLabelText('Paste text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import more' }));
    expect(screen.getByLabelText('Paste text')).toHaveValue('');
    await user.type(screen.getByLabelText('Paste text'), '# Third\nMore');
    vi.mocked(ApiClient.createPrompt).mockResolvedValueOnce(saved({ id: 22, name: 'Third', folder: null }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Keep as written' }));
    await user.click(await screen.findByRole('button', { name: 'Open imported prompt' }));
    expect(push).toHaveBeenCalledWith('/editor/22');
    expect(rowNames()).toEqual(expect.arrayContaining(['First', 'Second', 'Third']));
  });

  it('carries favorites from a JSON export without sending them on create', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValue(saved({ id: 20, name: 'Starred' }));
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(saved({ id: 20, name: 'Starred', is_favorite: true }));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    fireEvent.change(screen.getByLabelText('Paste text'), { target: { value: JSON.stringify({ prompts: [{ name: 'Starred', is_favorite: true, fields: [{ name: 'Task', content: 'Hi' }] }] }) } });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('button', { name: 'Make reusable with AI' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 1 prompt' }));
    await screen.findByText('Imported 1 of 1 prompts.');
    expect(ApiClient.createPrompt).toHaveBeenCalledWith({ name: 'Starred', folder: null, fields: [{ name: 'Task', content: 'Hi' }] });
    expect(ApiClient.updatePrompt).toHaveBeenCalledWith(20, { is_favorite: true });
  });

  it('hands a single pasted note to AI conversion in the editor', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), 'Plan a trip to Lisbon.');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Make reusable with AI' }));
    expect(JSON.parse(sessionStorage.getItem(pasteHandoffKey())!)).toEqual({ text: 'Plan a trip to Lisbon.', title: 'Imported note', folder: null });
    expect(push).toHaveBeenCalledWith('/editor/new?import=1');
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
  });

  it('drops note frontmatter and its title line unless the original is kept, and hands the body to AI', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    fireEvent.change(screen.getByLabelText('Paste text'), { target: { value: '---\ntitle: Blog outline\ntags: [writing]\n---\n# Blog outline\nOutline a post.\n## Output\n- 5 headings' } });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByLabelText('Title for prompt 1')).toHaveValue('Blog outline');
    expect(screen.queryByText(/tags: \[writing\]/)).not.toBeInTheDocument();
    expect(screen.getByText('2 sections')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Keep the original note text/ }));
    expect(screen.getByText(/tags: \[writing\]/)).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /Keep the original note text/ }));

    // The note's first tag is the suggested folder.
    expect(screen.getByLabelText('Folder for Blog outline')).toHaveValue('Writing');
    await user.click(screen.getByRole('button', { name: 'Make reusable with AI' }));
    expect(JSON.parse(sessionStorage.getItem(pasteHandoffKey())!)).toEqual({ text: 'Outline a post.\n\n## Output\n- 5 headings', title: 'Blog outline', folder: 'Writing' });
  });

  it('offers to turn found placeholders into inputs, with undo', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValue(saved({ id: 20, name: 'Post' }));
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    fireEvent.change(screen.getByLabelText('Paste text'), { target: { value: '# Post\nWrite about [TOPIC] for {audience}.' } });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText(/Found 2 placeholders/)).toHaveTextContent('[TOPIC]{audience}');
    await user.click(screen.getByRole('button', { name: 'Turn them into inputs' }));
    expect(screen.getByText('Write about {{topic}} for {{audience}}.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Write about [TOPIC] for {audience}.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Turn them into inputs' }));
    await user.click(screen.getByRole('button', { name: 'Keep as written' }));
    await waitFor(() => expect(ApiClient.createPrompt).toHaveBeenCalledWith({ name: 'Post', folder: null, fields: [{ name: 'Prompt', content: 'Write about {{topic}} for {{audience}}.' }] }));
  });

  it('files every previewed prompt in one folder', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.type(screen.getByLabelText('Paste text'), '# First\nHello\n# Second\nThanks');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.type(screen.getByLabelText('Folder for all prompts'), 'Team');
    expect(screen.getByLabelText('Folder for First')).toHaveValue('Team');
    expect(screen.getByLabelText('Folder for Second')).toHaveValue('Team');
    await user.clear(screen.getByLabelText('Folder for Second'));
    expect(screen.getByLabelText('Folder for all prompts')).toHaveValue('');
  });

  it('copies a single-section prompt as plain text, with tags on request', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([saved({ fields: [{ name: 'Prompt', content: 'Just {{this}}.' }], generated_prompt: '<PROMPT>\nJust {{this}}.\n</PROMPT>' })]);
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Copy the Weekly status update template' }));
    expect(await navigator.clipboard.readText()).toBe('Just {{this}}.');
    await user.click(screen.getByRole('button', { name: 'More actions for Weekly status update' }));
    expect(screen.queryByRole('button', { name: 'Copy as plain text' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy with section tags' }));
    expect(await navigator.clipboard.readText()).toBe('<PROMPT>\nJust {{this}}.\n</PROMPT>');
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

  it('copies section content as plain text without removing literal tags or placeholders', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([saved({ fields: [
      { name: 'Task', content: 'Keep <TASK>literal</TASK> and {{name}}.' },
      { name: 'Format', content: 'Two lines.\nKeep them.' },
    ] })]);
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'More actions for Weekly status update' }));
    await user.click(screen.getByRole('button', { name: 'Copy as plain text' }));
    expect(await navigator.clipboard.readText()).toBe('Keep <TASK>literal</TASK> and {{name}}.\n\nTwo lines.\nKeep them.');
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
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(rowNames()).not.toContain('LinkedIn post');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(rowNames()).toContain('LinkedIn post');
    expect(ApiClient.deletePrompt).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More actions for LinkedIn post' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    // Leaving before the window closes still sends the delete.
    view.unmount();
    expect(ApiClient.flushDeletePrompt).toHaveBeenCalledWith(3);
  });

  it('closes a prompt menu on Escape and returns focus to its button', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    const more = screen.getByRole('button', { name: 'More actions for Weekly status update' });

    await user.click(more);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy template' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it('renames a prompt in place', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(saved({ name: 'Status update' }));
    await renderLibrary();

    await user.click(screen.getByRole('button', { name: 'More actions for Weekly status update' }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
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
    await user.click(screen.getByRole('button', { name: 'Move to folder…' }));
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
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await user.click(await screen.findByRole('button', { name: 'Open copy' }));

    expect(push).toHaveBeenCalledWith('/editor/9');
  });

  it('renames a folder and follows it to its new name', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.renameFolder).mockResolvedValue({ name: 'Job', prompt_count: 1 });
    await renderLibrary('folder=Work');

    await user.click(screen.getByRole('button', { name: 'Actions for the Work folder' }));
    await user.click(screen.getByRole('button', { name: 'Rename folder' }));
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
    await user.click(screen.getByRole('button', { name: 'Remove folder…' }));
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

  it('remembers the layout toggle as the library view setting', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    expect(AuthService.updateProfile).toHaveBeenCalledWith({ default_library_view: 'grid' });
  });

  it('does not reuse a chosen file name as the title of text pasted afterwards', async () => {
    // jsdom has no Blob.text(); browsers do.
    File.prototype.text ??= function (this: File) {
      return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(this); });
    };
    const user = userEvent.setup();
    await renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
    await user.upload(screen.getByLabelText(/Or choose files/), new File(['A note from a file'], 'Old file.md', { type: 'text/markdown' }));
    await waitFor(() => expect(screen.getByLabelText('Title for a single note')).toHaveValue('Old file'));
    fireEvent.change(screen.getByLabelText('Paste text'), { target: { value: 'Something pasted instead' } });
    expect(screen.getByLabelText('Title for a single note')).toHaveValue('');
  });

  describe('several files at once', () => {
    beforeEach(() => {
      // jsdom has no Blob.text(); browsers do.
      File.prototype.text ??= function (this: File) {
        return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(this); });
      };
    });
    const note = (text: string, name: string, path?: string) => {
      const file = new File([text], name, { type: 'text/markdown' });
      if (path) Object.defineProperty(file, 'webkitRelativePath', { value: path });
      return file;
    };

    it('previews several chosen files together, titled from their names without Notion IDs', async () => {
      const user = userEvent.setup();
      vi.mocked(ApiClient.createPrompt).mockImplementation(async (body) => saved({ id: 30, name: body.name, folder: body.folder }));
      await renderLibrary();
      await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
      await user.upload(screen.getByLabelText(/Or choose files/), [
        note('Write about [X].', 'Cold email 8b7e6d5c4a3b2a1f8b7e6d5c4a3b2a1f.md'),
        note('# Meeting summary\nSummarise it.', 'meeting.md'),
      ]);
      expect(await screen.findByText(/2 files ready: Cold email 8b7e/)).toBeInTheDocument();
      expect(screen.getByLabelText('Paste text')).toHaveValue('');
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      expect(screen.getByLabelText('Title for prompt 1')).toHaveValue('Cold email');
      expect(screen.getByLabelText('Title for prompt 2')).toHaveValue('Meeting summary');
      expect(screen.queryByRole('button', { name: 'Make reusable with AI' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Import 2 prompts' }));
      await screen.findByText('Imported 2 of 2 prompts.');
    });

    it('reads a chosen folder, ignoring app settings and other files, and suggests each note\'s folder', async () => {
      const user = userEvent.setup();
      await renderLibrary();
      await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
      await user.upload(screen.getByLabelText(/Or choose a folder/), [
        note('Outline [TOPIC].', 'Blog.md', 'Vault/Prompts/Blog.md'),
        note('{"theme": "dark"}', 'app.json', 'Vault/.obsidian/app.json'),
        note('png', 'image.png', 'Vault/Prompts/image.png'),
        note('', 'Empty.md', 'Vault/Empty.md'),
      ]);
      expect(await screen.findByText(/2 files ready/)).toBeInTheDocument();
      expect(screen.getByText('2 other files were ignored.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      expect(screen.getByLabelText('Title for prompt 1')).toHaveValue('Blog');
      expect(screen.getByLabelText('Folder for Blog')).toHaveValue('Prompts');
      expect(screen.getByText(/Skipped: Empty.md: Include some note text/)).toBeInTheDocument();
    });

    it('accepts files dropped onto the dialog', async () => {
      const user = userEvent.setup();
      await renderLibrary();
      await user.click(screen.getByRole('button', { name: 'Add existing prompts' }));
      const files = [note('First [A].', 'a.md'), note('Second [B].', 'b.md')];
      const entry = (file: File) => ({ isFile: true, name: file.name, file: (resolve: (f: File) => void) => resolve(file) });
      const items = files.map(file => ({ webkitGetAsEntry: () => entry(file) }));
      fireEvent.drop(screen.getByLabelText('Paste text').closest('div[data-dragging], div')!.parentElement!, { dataTransfer: { items, types: ['Files'], files } });
      expect(await screen.findByText(/2 files ready: a.md, b.md/)).toBeInTheDocument();
    });
  });

  it('marks inputs in prompt snippets', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([saved({ fields: [{ name: 'Task', content: 'Summarise {{notes}} for {{team}}.' }] })]);
    const { container } = await renderLibrary();
    expect([...container.querySelectorAll('li p span')].map(span => span.textContent)).toEqual(['{{notes}}', '{{team}}']);
  });

  it('invites a first prompt when the library is empty', async () => {
    vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([]);
    await renderLibrary();

    expect(screen.getByRole('heading', { name: 'Your prompt library is empty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add existing prompts' })).toHaveClass(/primary/);
    expect(screen.getByText(/Notion, Obsidian or Markdown files/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New prompt' })).toHaveAttribute('href', '/editor/new');
    expect(screen.queryByRole('link', { name: 'Paste a prompt' })).not.toBeInTheDocument();
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
