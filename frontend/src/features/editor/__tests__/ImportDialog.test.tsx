import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClient } from '@/lib/api';
import ImportDialog from '../ImportDialog';
import type { ImportSession } from '../editorState';

vi.mock('@/lib/api', () => ({ ApiClient: { parsePromptText: vi.fn() } }));

const source = 'Plan a 3-day trip to Lisbon.';
const conversion = {
  fields: [{ name: 'Task', content: 'Plan a {{duration}} trip to {{destination}}.' }],
  variables: [
    { name: 'duration', value: '3-day', description: 'Trip length', source_text: '3-day' },
    { name: 'destination', value: 'Lisbon', description: 'Destination', source_text: 'Lisbon' },
  ],
};
const apply = vi.fn();

function Host() {
  const [session, setSession] = useState<ImportSession>({ text: '' });
  return <ImportDialog isOpen aiAvailable aiConfig={{ provider_connected: true, provider: 'ollama', provider_label: 'Ollama', model: 'local', available_models: [], budget_exhausted: false, global_budget_remaining_usd: null }}
    replacesContent session={session} onSessionChange={setSession} onClose={vi.fn()} onImport={apply} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ApiClient.parsePromptText).mockResolvedValue(conversion);
});

async function convert() {
  const user = userEvent.setup();
  render(<Host />);
  fireEvent.change(screen.getByLabelText('Prompt to convert'), { target: { value: source } });
  await user.click(screen.getByRole('button', { name: 'Create template' }));
  await screen.findByRole('button', { name: 'Use in editor' });
  return user;
}

it('reviews and copies original values before changing the draft', async () => {
  const user = await convert();
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  expect(ApiClient.parsePromptText).toHaveBeenCalledWith({ text: source, extract_variables: true });
  expect(screen.getByLabelText('Converted prompt preview')).toHaveTextContent('Plan a 3-day trip to Lisbon.');
  expect(screen.getByLabelText('Value for destination')).toHaveValue('Lisbon');
  expect(screen.getByRole('checkbox', { name: 'Keep these inputs as examples' })).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));
  expect(clipboard).toHaveBeenCalledWith('<TASK>\nPlan a 3-day trip to Lisbon.\n</TASK>');
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('radio', { name: 'Template' }));
  expect(screen.getByLabelText('Converted prompt preview')).toHaveTextContent('{{destination}}');
  await user.click(screen.getByRole('button', { name: 'Use in editor' }));
  expect(apply).toHaveBeenCalledWith({
    fields: conversion.fields,
    values: { duration: '3-day', destination: 'Lisbon' },
    metadata: { duration: { type: 'text', description: 'Trip length' }, destination: { type: 'text', description: 'Destination' } },
  });
});

it('renames variables, keeps a value fixed, and saves examples only on request without another AI call', async () => {
  const user = await convert();
  fireEvent.change(screen.getByLabelText('Variable name for destination'), { target: { value: 'city' } });
  await user.click(screen.getByRole('checkbox', { name: 'Use duration as a variable' }));
  fireEvent.change(screen.getByLabelText('Value for destination'), { target: { value: 'Porto' } });
  await user.click(screen.getByRole('checkbox', { name: 'Keep these inputs as examples' }));
  await user.click(screen.getByRole('button', { name: 'Use in editor' }));
  expect(apply).toHaveBeenCalledWith({
    fields: [{ name: 'Task', content: 'Plan a 3-day trip to {{city}}.' }],
    values: { city: 'Porto' }, metadata: { city: { type: 'text', description: 'Destination', example: 'Porto' } },
  });
  expect(ApiClient.parsePromptText).toHaveBeenCalledTimes(1);
});

it('blocks invalid or duplicate variable names and restores previous review after viewing source', async () => {
  const user = await convert();
  fireEvent.change(screen.getByLabelText('Variable name for destination'), { target: { value: 'duration' } });
  expect(screen.getByRole('button', { name: 'Use in editor' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Copy filled prompt' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Variable name for destination'), { target: { value: 'bad name' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Variable names');
  fireEvent.change(screen.getByLabelText('Variable name for destination'), { target: { value: 'city' } });
  await user.click(screen.getByRole('button', { name: 'Back to source' }));
  expect(screen.getByLabelText('Prompt to convert')).toHaveValue(source);
  await user.click(screen.getByRole('button', { name: 'Return to review' }));
  expect(screen.getByLabelText('Variable name for destination')).toHaveValue('city');
  expect(ApiClient.parsePromptText).toHaveBeenCalledTimes(1);
});

it('keeps source text after errors and supports an explicit retry', async () => {
  const user = userEvent.setup();
  vi.mocked(ApiClient.parsePromptText).mockRejectedValueOnce(new Error('Provider unavailable'));
  render(<Host />);
  fireEvent.change(screen.getByLabelText('Prompt to convert'), { target: { value: source } });
  await user.click(screen.getByRole('button', { name: 'Create template' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable');
  expect(screen.getByLabelText('Prompt to convert')).toHaveValue(source);
  await user.click(screen.getByRole('button', { name: 'Create template' }));
  expect(await screen.findByRole('button', { name: 'Use in editor' })).toBeEnabled();
});

it('keeps existing empty placeholders and offers explicit placeholder copying', async () => {
  vi.mocked(ApiClient.parsePromptText).mockResolvedValue({
    fields: [{ name: 'Task', content: 'Explain {{topic}} to Lisbon residents. Use {{topic}} again.' }],
    variables: [{ name: 'topic', value: '', description: 'Subject', source_text: null }],
  });
  const user = await convert();
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  expect(screen.getByText('Existing placeholder; the source did not supply a value.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy with placeholders' }));
  expect(clipboard).toHaveBeenCalledWith('<TASK>\nExplain {{topic}} to Lisbon residents. Use {{topic}} again.\n</TASK>');
  fireEvent.change(screen.getByLabelText('Value for topic'), { target: { value: 'Space\n& planets' } });
  await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));
  expect(clipboard).toHaveBeenLastCalledWith('<TASK>\nExplain Space\n& planets to Lisbon residents. Use Space\n& planets again.\n</TASK>');
});

it('renames all occurrences simultaneously when names are swapped', async () => {
  const user = await convert();
  fireEvent.change(screen.getByLabelText('Variable name for duration'), { target: { value: 'destination' } });
  fireEvent.change(screen.getByLabelText('Variable name for destination'), { target: { value: 'duration' } });
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(screen.getByRole('button', { name: 'Copy template' }));
  expect(clipboard).toHaveBeenCalledWith('<TASK>\nPlan a {{destination}} trip to {{duration}}.\n</TASK>');
  await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));
  expect(clipboard).toHaveBeenLastCalledWith('<TASK>\nPlan a 3-day trip to Lisbon.\n</TASK>');
});

it('reports clipboard failure and blocks keeping an empty value fixed', async () => {
  const user = await convert();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Permission denied'));
  await user.click(screen.getByRole('button', { name: 'Copy template' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Select the preview text');
  fireEvent.change(screen.getByLabelText('Value for destination'), { target: { value: '' } });
  await user.click(screen.getByRole('checkbox', { name: 'Use destination as a variable' }));
  expect(screen.getByRole('button', { name: 'Use in editor' })).toBeDisabled();
  expect(screen.getByText('Enter a value before keeping a placeholder fixed.')).toBeInTheDocument();
});

it('preserves whitespace values in the review just as the optional editor inputs do', async () => {
  const user = await convert();
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  fireEvent.change(screen.getByLabelText('Value for destination'), { target: { value: '  ' } });
  await user.click(screen.getByRole('button', { name: 'Copy filled prompt' }));
  expect(clipboard).toHaveBeenCalledWith('<TASK>\nPlan a 3-day trip to   .\n</TASK>');
});

it('keeps pasted content exactly without AI when disconnected', async () => {
  const user = userEvent.setup();
  const text = '  Write an update.\nKeep these spaces.  ';
  render(<ImportDialog isOpen aiAvailable={false} aiConfig={null} replacesContent={false}
    session={{ text }} onSessionChange={vi.fn()} onClose={vi.fn()} onImport={apply} />);
  await user.click(screen.getByRole('button', { name: 'Save as written' }));
  expect(apply).toHaveBeenCalledWith({ fields: [{ name: 'Task', content: text }], metadata: {}, values: {}, saveAsWritten: true });
  expect(ApiClient.parsePromptText).not.toHaveBeenCalled();
});
