import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptEditor from '../PromptEditor';
import { ApiClient, ApiError } from '@/lib/api';
import { storageKey } from '@/lib/branding';
import type { PromptHistoryResponse, PromptVersionResponse } from '@/types/prompt';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  ApiClient: {
    getPromptById: vi.fn(),
    getPromptVersions: vi.fn(),
    getPromptsConfig: vi.fn(),
    getFolders: vi.fn(),
    updatePrompt: vi.fn(),
    createPrompt: vi.fn(),
    restorePromptVersion: vi.fn(),
    parsePromptText: vi.fn(),
  },
}));

// Supplied by `(app)/layout.tsx` in the real app; drafts are namespaced by it.
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ currentUser: 'alex', logout: vi.fn() }),
}));

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));

function prompt(overrides: Partial<PromptHistoryResponse> = {}): PromptHistoryResponse {
  return {
    id: 1,
    name: 'Weekly status update',
    fields: [
      { name: 'Role', content: 'You are a concise engineering lead.' },
      { name: 'Context', content: 'Team: {{team}}\nNotes: {{notes}}' },
    ],
    generated_prompt:
      '<ROLE>\nYou are a concise engineering lead.\n</ROLE>\n\n<CONTEXT>\nTeam: {{team}}\nNotes: {{notes}}\n</CONTEXT>',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    folder: 'Work',
    is_favorite: false,
    variable_metadata: { team: { type: 'list', description: 'Team or project name' } },
    ...overrides,
  };
}

function version(overrides: Partial<PromptVersionResponse> = {}): PromptVersionResponse {
  return {
    id: 11,
    version_number: 1,
    note: 'Added the notes variable',
    author: 'alex',
    fields: [{ name: 'Role', content: 'You are an engineering lead.' }],
    generated_prompt: '<ROLE>\nYou are an engineering lead.\n</ROLE>',
    created_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

const draftKey = (id: number | 'new') => storageKey(`editor-draft:alex:${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(ApiClient.getPromptById).mockResolvedValue(prompt());
  vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([]);
  vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
    provider_connected: true,
    provider: 'openai',
    provider_label: 'OpenAI',
    model: 'gpt-4.1-mini',
    available_models: [],
    budget_exhausted: false,
    global_budget_remaining_usd: null,
  });
  vi.mocked(ApiClient.getFolders).mockResolvedValue(['Work', 'Writing']);
});

async function renderSaved() {
  render(<PromptEditor promptId={1} />);
  await screen.findByRole('button', { name: 'Weekly status update' });
}

describe('PromptEditor with a saved prompt', () => {
  it('shows its sections and opens the preview filled in when it has variables', async () => {
    await renderSaved();

    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead.');
    expect(screen.getByRole('radio', { name: 'Filled' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Prompt text')).toHaveTextContent('<CONTEXT>');
    expect(screen.getByPlaceholderText('Team or project name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('saves edited sections with Ctrl+S, sending sections but never the text', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (_id, body) =>
      prompt({ fields: body.fields!, updated_at: '2026-07-09T00:00:00Z' }),
    );
    await renderSaved();

    await user.type(screen.getByLabelText('Role text'), ' Be brief.');
    expect(screen.getByText('Edited')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Version note'), 'Shorter role');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalledTimes(1));
    const body = vi.mocked(ApiClient.updatePrompt).mock.calls[0][1];
    expect(body).toEqual({
      fields: [
        { name: 'Role', content: 'You are a concise engineering lead. Be brief.' },
        { name: 'Context', content: 'Team: {{team}}\nNotes: {{notes}}' },
      ],
      variable_metadata: { team: { type: 'list', description: 'Team or project name' } },
      note: 'Shorter role',
      last_updated_at: '2026-07-08T00:00:00Z',
    });
    expect(body).not.toHaveProperty('generated_prompt');
    expect(await screen.findByText('Saved', { selector: '[role="status"]' })).toBeInTheDocument();
    expect(ApiClient.getPromptVersions).toHaveBeenCalledTimes(2);
  });

  it('does nothing on Ctrl+S when nothing changed', async () => {
    await renderSaved();

    fireEvent.keyDown(window, { key: 's', metaKey: true });

    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
  });

  it('blocks saving while two sections render to the same tag', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'Add section' }));
    const names = screen.getAllByLabelText('Section name');
    await user.clear(names[2]);
    await user.type(names[2], 'role');

    // Both clashing sections say so.
    expect(screen.getAllByText(/Another section already becomes <ROLE>/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(ApiClient.updatePrompt).not.toHaveBeenCalled();
    expect(screen.getByText('Fix the highlighted section names before saving.')).toBeInTheDocument();
  });

  it('keeps a hint’s stored type when the hint is edited', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockResolvedValue(prompt());
    await renderSaved();

    await user.type(screen.getByLabelText('Hint for notes'), 'Paste standup notes');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(ApiClient.updatePrompt).toHaveBeenCalled());
    expect(vi.mocked(ApiClient.updatePrompt).mock.calls[0][1].variable_metadata).toEqual({
      team: { type: 'list', description: 'Team or project name' },
      notes: { type: 'text', description: 'Paste standup notes' },
    });
  });

  it('restores a draft made against the same saved state, and can discard it', async () => {
    const user = userEvent.setup();
    const saved = prompt();
    localStorage.setItem(
      draftKey(1),
      JSON.stringify({
        base: JSON.stringify({
          fields: saved.fields,
          metadata: [['team', saved.variable_metadata!.team]],
        }),
        sections: [{ name: 'Role', content: 'Draft role' }],
        metadata: saved.variable_metadata,
      }),
    );

    await renderSaved();

    expect(screen.getByText('Your unsaved changes were restored.')).toBeInTheDocument();
    expect(screen.getByLabelText('Role text')).toHaveValue('Draft role');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead.');
    expect(localStorage.getItem(draftKey(1))).toBeNull();
  });

  it('ignores a draft made against an older saved state', async () => {
    localStorage.setItem(
      draftKey(1),
      JSON.stringify({ base: 'something older', sections: [{ name: 'Role', content: 'x' }], metadata: {} }),
    );

    await renderSaved();

    expect(screen.queryByText('Your unsaved changes were restored.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead.');
  });

  it('copies the filled prompt, flagging variables left as placeholders', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.type(screen.getByPlaceholderText('Team or project name'), 'Payments');
    expect(screen.getByText(/is not filled in/)).toHaveTextContent('notes is not filled in');
    await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));

    expect(await navigator.clipboard.readText()).toBe(
      '<ROLE>\nYou are a concise engineering lead.\n</ROLE>\n\n<CONTEXT>\nTeam: Payments\nNotes: {{notes}}\n</CONTEXT>',
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('copies the template without any unfilled-variable warning', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.click(screen.getByRole('radio', { name: 'Template' }));
    expect(screen.queryByText(/not filled in/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy template' }));

    expect(await navigator.clipboard.readText()).toBe(prompt().generated_prompt);
  });

  it('keeps edits through a conflict and loads the other session’s version on request', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockRejectedValue(new ApiError('modified elsewhere', 409));
    await renderSaved();

    await user.type(screen.getByLabelText('Role text'), ' Mine.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    vi.mocked(ApiClient.getPromptById).mockResolvedValue(
      prompt({ updated_at: '2026-07-10T00:00:00Z' }),
    );
    await user.click(screen.getByRole('button', { name: 'Load latest version' }));

    await waitFor(() => expect(screen.queryByText(/changed somewhere else/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Role text')).toHaveValue('You are a concise engineering lead. Mine.');
  });

  it('compares a version with the current text and restores it', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version()]);
    vi.mocked(ApiClient.restorePromptVersion).mockResolvedValue(
      prompt({ fields: version().fields, generated_prompt: version().generated_prompt }),
    );
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'History' }));
    const history = screen.getByRole('complementary', { name: 'Version history' });
    expect(within(history).getByText('Version 2, current')).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: /Version 1/ }));
    expect(within(history).getByLabelText('Changes since this version')).toHaveTextContent('concise');
    await user.click(within(history).getByRole('button', { name: 'Restore version 1' }));

    await waitFor(() => expect(ApiClient.restorePromptVersion).toHaveBeenCalledWith(1, 11));
    expect(screen.getByLabelText('Role text')).toHaveValue('You are an engineering lead.');
    expect(screen.getByText('Restored version 1')).toBeInTheDocument();
  });

  it('does not restore over unsaved edits', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptVersions).mockResolvedValue([version()]);
    await renderSaved();

    await user.type(screen.getByLabelText('Role text'), ' Edited.');
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(screen.getByRole('button', { name: /Version 1/ }));

    expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeDisabled();
    expect(screen.getByText('Save or discard your edits before restoring.')).toBeInTheDocument();
  });

  it('removes a section with an undo', async () => {
    const user = userEvent.setup();
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'Remove Context' }));
    expect(screen.queryByLabelText('Context text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Context text')).toBeInTheDocument();
  });

  it('warns about uneven tags and, once left, empty sections', async () => {
    const user = userEvent.setup();
    await renderSaved();

    const role = screen.getByLabelText('Role text');
    await user.clear(role);
    await user.type(role, 'Use <b>bold');
    expect(screen.getByText(/<b> opens and closes an uneven number of times/)).toBeInTheDocument();

    await user.clear(role);
    expect(screen.getByText(/This section is empty/)).toBeInTheDocument();
  });

  it('renames and moves the prompt without touching its content', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.updatePrompt).mockImplementation(async (_id, body) =>
      prompt({ ...body, updated_at: '2026-07-09T00:00:00Z' } as Partial<PromptHistoryResponse>),
    );
    await renderSaved();

    await user.click(screen.getByRole('button', { name: 'Weekly status update' }));
    const name = screen.getByLabelText('Prompt name');
    await user.clear(name);
    await user.type(name, 'Status update{Enter}');
    await waitFor(() =>
      expect(ApiClient.updatePrompt).toHaveBeenCalledWith(1, {
        name: 'Status update',
        last_updated_at: '2026-07-08T00:00:00Z',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Work' }));
    const folder = screen.getByRole('dialog', { name: 'Move to folder' });
    await user.clear(within(folder).getByRole('combobox'));
    await user.type(within(folder).getByRole('combobox'), 'Writing');
    await user.click(within(folder).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(ApiClient.updatePrompt).toHaveBeenLastCalledWith(1, {
        folder: 'Writing',
        last_updated_at: '2026-07-09T00:00:00Z',
      }),
    );
  });
});

describe('PromptEditor with a new prompt', () => {
  it('asks for a name, creates the prompt, and moves to its page', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.createPrompt).mockResolvedValue(prompt({ id: 42 }));
    render(<PromptEditor />);

    await user.type(screen.getByLabelText('Task text'), 'Summarise {{{{text}}');
    expect(localStorage.getItem(draftKey('new'))).not.toBeNull();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'Save prompt' });
    await user.type(within(dialog).getByPlaceholderText(/Weekly status update/), 'Summariser');
    await user.type(within(dialog).getByRole('combobox'), 'Writing');
    await user.click(within(dialog).getByRole('button', { name: 'Save prompt' }));

    await waitFor(() =>
      expect(ApiClient.createPrompt).toHaveBeenCalledWith({
        name: 'Summariser',
        fields: [{ name: 'Task', content: 'Summarise {{text}}' }],
        folder: 'Writing',
        variable_metadata: {},
      }),
    );
    expect(routerReplace).toHaveBeenCalledWith('/editor/42');
    expect(localStorage.getItem(draftKey('new'))).toBeNull();
  });

  it('requires a name before creating', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save prompt' });
    await user.click(within(dialog).getByRole('button', { name: 'Save prompt' }));

    expect(within(dialog).getByText('Give the prompt a name.')).toBeInTheDocument();
    expect(ApiClient.createPrompt).not.toHaveBeenCalled();
  });

  it('starts from a starter template', async () => {
    const user = userEvent.setup();
    render(<PromptEditor />);

    await user.click(screen.getByRole('button', { name: 'Starter templates' }));
    await user.click(screen.getByRole('menuitem', { name: /Rewrite my text/ }));

    expect(screen.getAllByLabelText('Section name').map((el) => (el as HTMLInputElement).value)).toEqual([
      'Text',
      'Goal',
      'Keep',
      'Tone',
    ]);
    expect(screen.getByLabelText('Text text')).toHaveValue('{{text}}');
  });

  it('imports text into sections when an AI connection is available', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
      fields: [
        { name: 'role', content: 'A careful proofreader' },
        { name: 'task', content: 'Fix typos only' },
      ],
    });
    render(<PromptEditor />);

    await user.click(screen.getByRole('button', { name: 'Import text' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import text' });
    await user.type(within(dialog).getByLabelText('Text to import'), 'Proofread my text, typos only');
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(screen.getByLabelText('role text')).toHaveValue('A careful proofreader'));
    expect(screen.getByText(/Imported 2 sections/)).toBeInTheDocument();
  });

  it('explains Import text and links to Settings when no AI connection exists', async () => {
    const user = userEvent.setup();
    vi.mocked(ApiClient.getPromptsConfig).mockResolvedValue({
      provider_connected: false,
      provider: null,
      provider_label: null,
      model: null,
      available_models: [],
      budget_exhausted: false,
      global_budget_remaining_usd: null,
    });
    render(<PromptEditor />);
    await waitFor(() => expect(ApiClient.getPromptsConfig).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Import text' }));

    const dialog = await screen.findByRole('dialog', { name: 'Import text needs an AI connection' });
    expect(within(dialog).getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings#s-api',
    );
    expect(ApiClient.parsePromptText).not.toHaveBeenCalled();
  });
});

describe('PromptEditor load errors', () => {
  it('says when a prompt does not exist', async () => {
    vi.mocked(ApiClient.getPromptById).mockRejectedValue(
      new Error('Prompt not found — it may have been deleted.'),
    );
    render(<PromptEditor promptId={99} />);

    expect(await screen.findByRole('heading', { name: 'Prompt not found' })).toBeInTheDocument();
  });
});
