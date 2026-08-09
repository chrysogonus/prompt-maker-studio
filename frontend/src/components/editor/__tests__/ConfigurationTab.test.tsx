import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfigurationTab from '../ConfigurationTab';
import { PromptHistoryResponse, PromptVersionResponse } from '@/types/prompt';

function prompt(overrides: Partial<PromptHistoryResponse> = {}): PromptHistoryResponse {
  return {
    id: 1,
    name: 'Customer Support Triage',
    fields: [{ name: 'goal', content: 'triage' }],
    generated_prompt: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    folder: 'Support',
    is_favorite: false,
    tags: ['gpt-4o'],
    run_count: 0,
    variable_metadata: null,
    ...overrides,
  };
}

function renderTab(overrides: Partial<Parameters<typeof ConfigurationTab>[0]> = {}) {
  const props = {
    prompt: prompt(),
    templateText: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
    setTemplateText: vi.fn(),
    versions: [] as PromptVersionResponse[],
    isSaving: false,
    onRestore: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onVariableMetadataChange: vi.fn(),
    ...overrides,
  };
  render(<ConfigurationTab {...props} />);
  return props;
}

describe('ConfigurationTab', () => {
  it('renders the template textarea and detected variable', () => {
    renderTab();
    expect(screen.getByLabelText('Prompt template')).toHaveValue(
      '<GOAL>\ntriage {{ticket_text}}\n</GOAL>'
    );
    expect(screen.getByText('ticket_text')).toBeInTheDocument();
  });

  it('calls setTemplateText on edit', async () => {
    const props = renderTab();
    await userEvent.type(screen.getByLabelText('Prompt template'), 'x');
    expect(props.setTemplateText).toHaveBeenCalled();
  });

  it('renders version history and restores a selected version', async () => {
    const onRestore = vi.fn();
    renderTab({
      onRestore,
      versions: [
        {
          id: 55,
          version_number: 1,
          note: null,
          author: 'testuser',
          fields: [{ name: 'goal', content: 'old' }],
          generated_prompt: '<GOAL>\nold content\n</GOAL>',
          created_at: '2026-07-05T00:00:00Z',
        },
      ],
    });

    expect(screen.getByRole('button', { name: 'Compare with current' })).toBeInTheDocument();
    expect(screen.getByRole('tooltip', { name: 'Compare with current' })).toBeInTheDocument();
    expect(screen.getByRole('tooltip', { name: 'Restore this version' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('v1'));
    const comparison = await screen.findByLabelText('Version comparison');
    expect(comparison).toHaveTextContent('old');
    expect(comparison).toHaveTextContent('triage');
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(onRestore).toHaveBeenCalledWith(55);
  });

  it('labels the pre-refinement snapshot "Before AI refinement", even after a restore', () => {
    renderTab({
      versions: [
        {
          id: 2,
          version_number: 2,
          note: 'Restore to v1',
          author: 'testuser',
          fields: [],
          generated_prompt: 'refined',
          created_at: '2026-07-06T00:00:00Z',
        },
        {
          id: 1,
          version_number: 1,
          note: 'Before AI refinement',
          author: 'testuser',
          fields: [],
          generated_prompt: 'initial',
          created_at: '2026-07-05T00:00:00Z',
        },
      ],
    });

    // v1 holds the pre-refinement content and carries that note itself — it is
    // the version a user rolls a refinement back to, so it must say so rather
    // than read "Edit" like every other snapshot.
    expect(screen.getByText('Before AI refinement')).toBeInTheDocument();
    expect(screen.getByText('Before restore to v1')).toBeInTheDocument();
    // The live row is still described by the transition that produced it.
    expect(screen.getByText('Restored from v1')).toBeInTheDocument();
  });

  it('labels an unannotated snapshot by position, not by the next version\'s note', () => {
    renderTab({
      versions: [
        {
          id: 2,
          version_number: 2,
          note: null,
          author: 'testuser',
          fields: [],
          generated_prompt: 'second',
          created_at: '2026-07-06T00:00:00Z',
        },
        {
          id: 1,
          version_number: 1,
          note: null,
          author: 'testuser',
          fields: [],
          generated_prompt: 'first',
          created_at: '2026-07-05T00:00:00Z',
        },
      ],
    });

    expect(screen.getByText('Initial version')).toBeInTheDocument();
    // v2 plus the live row, both plain edits.
    expect(screen.getAllByText('Edit')).toHaveLength(2);
  });

  it('shows the real Playground run count in the Usage card', () => {
    renderTab({ prompt: prompt({ run_count: 12 }) });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('total runs')).toBeInTheDocument();
  });

  it('makes an identical historical snapshot explicit and does not offer a no-op restore', async () => {
    renderTab({
      versions: [
        {
          id: 56,
          version_number: 2,
          note: 'Snapshot',
          author: 'testuser',
          fields: [{ name: 'goal', content: 'triage' }],
          generated_prompt: '<GOAL>\ntriage {{ticket_text}}\n</GOAL>',
          created_at: '2026-07-06T00:00:00Z',
        },
      ],
    });

    await userEvent.click(screen.getByText('v2'));

    expect(screen.getByText('No changes since this version.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
  });

  it('changes a variable type and calls onVariableMetadataChange', async () => {
    const onVariableMetadataChange = vi.fn();
    renderTab({ onVariableMetadataChange });

    await userEvent.selectOptions(screen.getByLabelText('ticket_text type'), 'number');

    expect(onVariableMetadataChange).toHaveBeenCalledWith('ticket_text', { type: 'number' });
  });

  it('sets a variable description on blur and calls onVariableMetadataChange', async () => {
    const onVariableMetadataChange = vi.fn();
    renderTab({ onVariableMetadataChange });

    const descInput = screen.getByLabelText('ticket_text description');
    await userEvent.type(descInput, 'The raw ticket body');
    await userEvent.tab();

    expect(onVariableMetadataChange).toHaveBeenCalledWith('ticket_text', {
      description: 'The raw ticket body',
    });
  });

  it('adds a tag via the tag input on Enter', async () => {
    const onAddTag = vi.fn();
    renderTab({ onAddTag });

    const tagInput = screen.getByLabelText('Add tag');
    await userEvent.type(tagInput, 'new-tag{Enter}');

    expect(onAddTag).toHaveBeenCalledWith('new-tag');
  });

  it('removes a tag', async () => {
    const onRemoveTag = vi.fn();
    renderTab({ onRemoveTag });

    await userEvent.click(screen.getByLabelText('Remove tag gpt-4o'));

    expect(onRemoveTag).toHaveBeenCalledWith('gpt-4o');
  });

  it('uses a pressed toggle for wrapping without changing its label', async () => {
    renderTab();
    const wrapToggle = screen.getByRole('button', { name: 'Wrap lines' });

    expect(wrapToggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(wrapToggle);

    expect(wrapToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wrap lines' })).toBe(wrapToggle);
  });

  it('uses the icon swap as copy feedback for 1.5 seconds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    renderTab();

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    const iconSlot = copyButton.querySelector('[data-copied]');
    await userEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(copyButton).toHaveAccessibleName('Copy');
    expect(iconSlot).toHaveAttribute('data-copied', 'true');

    const resetCall = timeoutSpy.mock.calls.find(([, delay]) => delay === 1500);
    expect(resetCall).toBeDefined();
    act(() => {
      (resetCall?.[0] as () => void)();
    });
    expect(iconSlot).toHaveAttribute('data-copied', 'false');
    timeoutSpy.mockRestore();
  });
});
