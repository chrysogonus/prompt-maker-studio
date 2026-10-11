import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import type { PromptHistoryResponse } from '@/types/prompt';
import { LibraryDataProvider, useLibraryData } from '../LibraryData';
import { useLibrary } from '../useLibrary';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('folder=Work'),
}));
vi.mock('@/lib/api', () => ({ ApiClient: {
  getSavedPrompts: vi.fn(), renameFolder: vi.fn(), removeFolder: vi.fn(), flushDeletePrompt: vi.fn(),
} }));
vi.mock('@/lib/auth', () => ({ AuthService: { getCurrentUser: vi.fn() } }));

const prompt = (folder: string | null) => ({ id: 1, name: 'Saved', folder, fields: [] }) as unknown as PromptHistoryResponse;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(AuthService.getCurrentUser).mockResolvedValue({ username: 'alex' } as Awaited<ReturnType<typeof AuthService.getCurrentUser>>);
});

it.each(['rename', 'remove'] as const)('reloads %s results after an older shared read finishes', async operation => {
  let resolveOld!: (value: PromptHistoryResponse[]) => void;
  const destination = operation === 'rename' ? 'Job' : null;
  vi.mocked(ApiClient.getSavedPrompts)
    .mockResolvedValueOnce([prompt('Work')])
    .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue([prompt(destination)]);
  vi.mocked(ApiClient.renameFolder).mockResolvedValue({ name: 'Job', prompt_count: 1 });
  vi.mocked(ApiClient.removeFolder).mockResolvedValue({ name: 'Work', prompt_count: 1 });
  const { result } = renderHook(() => ({ library: useLibrary(), data: useLibraryData() }), {
    wrapper: LibraryDataProvider,
  });
  await waitFor(() => expect(result.current.library.prompts?.[0].folder).toBe('Work'));
  act(() => { void result.current.data.load(); });
  act(() => result.current.library.setFolderRename('Job'));
  let mutation!: Promise<void>;
  act(() => {
    mutation = operation === 'rename'
      ? result.current.library.renameFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent)
      : result.current.library.removeFolder();
  });
  await act(async () => resolveOld([prompt('Work')]));
  await act(async () => mutation);
  await waitFor(() => expect(result.current.data.prompts?.[0].folder).toBe(destination));
  expect(result.current.library.prompts?.[0].folder).toBe(destination);
  expect(replace).toHaveBeenCalledWith(operation === 'rename' ? '/library?folder=Job' : '/library?view=unfiled');
});


it.each(['stale', 'failed'] as const)('mounts the library with fresh data after invalidating a %s shared read', async outcome => {
  let resolveOld!: (value: PromptHistoryResponse[]) => void;
  let rejectOld!: (reason: Error) => void;
  vi.mocked(ApiClient.getSavedPrompts)
    .mockReturnValueOnce(new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
    .mockResolvedValue([prompt('Job')]);
  function SidebarRead() {
    const { load } = useLibraryData();
    useEffect(() => { void load().catch(() => {}); }, [load]);
    return null;
  }
  function LibrarySummary() {
    const { prompts } = useLibrary();
    return <output>{prompts?.[0].folder ?? 'Loading'}</output>;
  }
  const { rerender } = render(<LibraryDataProvider><SidebarRead /></LibraryDataProvider>);
  act(() => notifyLibraryChanged());
  rerender(<LibraryDataProvider><SidebarRead /><LibrarySummary /></LibraryDataProvider>);
  await act(async () => {
    if (outcome === 'failed') rejectOld(new Error('Older read failed'));
    else resolveOld([prompt('Work')]);
  });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Job'));
});
