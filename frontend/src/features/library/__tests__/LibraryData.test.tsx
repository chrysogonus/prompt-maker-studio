import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiClient } from '@/lib/api';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import type { PromptHistoryResponse } from '@/types/prompt';
import { LibraryDataProvider, useLibraryData } from '../LibraryData';

vi.mock('@/lib/api', () => ({ ApiClient: { getSavedPrompts: vi.fn() } }));

function Consumer({ label }: { label: string }) {
  const { prompts, load } = useLibraryData();
  useEffect(() => { void load().catch(() => {}); }, [load]);
  return <output aria-label={label}>{prompts?.map(p => p.name).join(',') ?? 'Loading'}</output>;
}

beforeEach(() => vi.resetAllMocks());

it('shares one in-flight load and refreshes both consumers after invalidation', async () => {
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([{ name: 'First' }] as PromptHistoryResponse[]);
  render(<LibraryDataProvider><Consumer label="Sidebar" /><Consumer label="Library" /></LibraryDataProvider>);
  await waitFor(() => expect(screen.getByLabelText('Sidebar')).toHaveTextContent('First'));
  expect(ApiClient.getSavedPrompts).toHaveBeenCalledTimes(1);
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([{ name: 'Updated' }] as PromptHistoryResponse[]);
  await act(async () => notifyLibraryChanged());
  expect(screen.getByLabelText('Sidebar')).toHaveTextContent('Updated');
  expect(screen.getByLabelText('Library')).toHaveTextContent('Updated');
  expect(ApiClient.getSavedPrompts).toHaveBeenCalledTimes(2);
});

it('does not carry an old account response into a newly mounted provider', async () => {
  let resolveOld!: (value: PromptHistoryResponse[]) => void;
  vi.mocked(ApiClient.getSavedPrompts).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const { rerender } = render(<LibraryDataProvider key="old"><Consumer label="Library" /></LibraryDataProvider>);
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([{ name: 'New account' }] as PromptHistoryResponse[]);
  rerender(<LibraryDataProvider key="new"><Consumer label="Library" /></LibraryDataProvider>);
  await waitFor(() => expect(screen.getByLabelText('Library')).toHaveTextContent('New account'));
  await act(async () => resolveOld([{ name: 'Old account' }] as PromptHistoryResponse[]));
  expect(screen.getByLabelText('Library')).toHaveTextContent('New account');
});

it('reads again when a mutation invalidates an in-flight response', async () => {
  let resolveRead!: (value: PromptHistoryResponse[]) => void;
  vi.mocked(ApiClient.getSavedPrompts)
    .mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }))
    .mockResolvedValueOnce([{ name: 'After mutation' }] as PromptHistoryResponse[]);
  render(<LibraryDataProvider><Consumer label="Library" /></LibraryDataProvider>);
  act(() => notifyLibraryChanged());
  expect(ApiClient.getSavedPrompts).toHaveBeenCalledTimes(1);
  await act(async () => resolveRead([{ name: 'Before mutation' }] as PromptHistoryResponse[]));
  await waitFor(() => expect(screen.getByLabelText('Library')).toHaveTextContent('After mutation'));
  expect(ApiClient.getSavedPrompts).toHaveBeenCalledTimes(2);
});

it('allows invalidation to retry a failed load', async () => {
  vi.mocked(ApiClient.getSavedPrompts).mockRejectedValueOnce(new Error('Offline'));
  render(<LibraryDataProvider><Consumer label="Library" /></LibraryDataProvider>);
  await act(async () => {});
  vi.mocked(ApiClient.getSavedPrompts).mockResolvedValue([{ name: 'Recovered' }] as PromptHistoryResponse[]);
  await act(async () => notifyLibraryChanged());
  expect(screen.getByLabelText('Library')).toHaveTextContent('Recovered');
});
