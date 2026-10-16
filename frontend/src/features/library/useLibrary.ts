'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import { pageTitle } from '@/lib/branding';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { libraryHref, viewFromParams, viewTitle } from '@/lib/libraryViews';

import { UNDO_MS, Prompt, Toast, editedAt } from './libraryState';
import { useLibraryData } from './LibraryData';

export function useLibrary() {
  const { load: loadLibrary, refresh: refreshLibrary } = useLibraryData();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = viewFromParams(searchParams);
  const title = viewTitle(view);

  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [moving, setMoving] = useState<{ prompt: Prompt; folder: string } | null>(null);
  const [folderRename, setFolderRename] = useState<string | null>(null);
  const [folderRemoveOpen, setFolderRemoveOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const pendingDelete = useRef<{ prompt: Prompt; timer: number } | null>(null);

  const showToast = useCallback((next: Toast, ms = 3500) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const load = useCallback(async (fresh = false) => {
    try {
      setPrompts(await (fresh ? refreshLibrary() : loadLibrary()));
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load your prompts.');
    }
  }, [loadLibrary, refreshLibrary]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load updates state after awaiting the library request.
    void load();
    AuthService.getCurrentUser()
      .then((user) => user.default_library_view && setLayout(user.default_library_view))
      .catch(() => {});
  }, [load]);

  useEffect(() => {
    document.title = pageTitle(title);
    return () => {
      document.title = pageTitle();
    };
  }, [title]);

  // A delete still inside its undo window must reach the server even if the
  // user navigates away or closes the tab, or the prompt silently comes back.
  useEffect(() => {
    const flush = () => {
      const pending = pendingDelete.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pendingDelete.current = null;
      ApiClient.flushDeletePrompt(pending.prompt.id);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (menuId === null && !folderMenuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && (event.target as Element).closest('[data-menu]')) return;
      // Escape from inside an open menu returns focus to its trigger, the wrapper's first button.
      if (event instanceof KeyboardEvent) document.activeElement?.closest('[data-menu]')?.querySelector('button')?.focus();
      setMenuId(null);
      setFolderMenuOpen(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [folderMenuOpen, menuId]);

  const replace = (updated: Prompt) =>
    setPrompts((current) => current?.map((p) => (p.id === updated.id ? updated : p)) ?? null);

  const inView = useMemo(() => {
    const all = prompts ?? [];
    switch (view.type) {
      case 'favorites':
        return all.filter((p) => p.is_favorite);
      case 'unfiled':
        return all.filter((p) => !p.folder);
      case 'folder':
        return all.filter((p) => p.folder === view.folder);
      default:
        return all;
    }
    // `view` is rebuilt every render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, view.type, view.type === 'folder' ? view.folder : null]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return inView
      .filter(
        (p) =>
          !query ||
          [p.name ?? '', p.folder ?? '', ...p.fields.flatMap((f) => [f.name, f.content])]
            .join(' ')
            .toLowerCase()
            .includes(query),
      )
      .sort((a, b) => editedAt(b).localeCompare(editedAt(a)));
  }, [inView, search]);

  const toggleFavorite = async (prompt: Prompt) => {
    replace({ ...prompt, is_favorite: !prompt.is_favorite });
    try {
      replace(await ApiClient.updatePrompt(prompt.id, { is_favorite: !prompt.is_favorite }));
      notifyLibraryChanged();
    } catch {
      replace(prompt);
      showToast({ text: 'Could not update favorites. Try again.' });
    }
  };

  const copyTemplate = async (prompt: Prompt) => {
    setMenuId(null);
    try {
      await navigator.clipboard.writeText(prompt.generated_prompt);
      showToast({ text: `Copied the “${prompt.name}” template` });
    } catch {
      showToast({ text: 'Copying failed. Open the prompt and copy it from the preview.' });
    }
  };

  const rename = async (prompt: Prompt, value: string) => {
    setRenamingId(null);
    const name = value.trim();
    if (!name || name === prompt.name) return;
    try {
      replace(await ApiClient.updatePrompt(prompt.id, { name }));
      if (prompts?.some((p) => p.id !== prompt.id && p.name === name)) {
        showToast({ text: `Another prompt is also called “${name}”.` });
      }
    } catch {
      showToast({ text: 'Could not rename the prompt. Try again.' });
    }
  };

  const move = async (event: FormEvent) => {
    event.preventDefault();
    if (!moving) return;
    const folder = moving.folder.trim();
    setMoving(null);
    try {
      replace(await ApiClient.updatePrompt(moving.prompt.id, { folder }));
      notifyLibraryChanged();
      showToast({ text: folder ? `Moved to ${folder}` : 'Moved to Unfiled' });
    } catch {
      showToast({ text: 'Could not move the prompt. Try again.' });
    }
  };

  const duplicate = async (prompt: Prompt) => {
    setMenuId(null);
    try {
      const copy = await ApiClient.duplicatePrompt(prompt.id);
      setPrompts((current) => [copy, ...(current ?? [])]);
      notifyLibraryChanged();
      showToast(
        {
          text: `Duplicated as “${copy.name}”`,
          action: { label: 'Open copy', run: () => router.push(`/editor/${copy.id}`) },
        },
        6000,
      );
    } catch {
      showToast({ text: 'Could not duplicate the prompt. Try again.' });
    }
  };

  const commitDelete = async (prompt: Prompt) => {
    pendingDelete.current = null;
    try {
      await ApiClient.deletePrompt(prompt.id);
      notifyLibraryChanged();
    } catch {
      setPrompts((current) => (current ? [prompt, ...current] : current));
      showToast({ text: `Could not delete “${prompt.name}”. It is back in your library.` });
    }
  };

  const remove = (prompt: Prompt) => {
    setMenuId(null);
    // Only one delete waits at a time; an earlier one goes through now.
    const earlier = pendingDelete.current;
    if (earlier) {
      window.clearTimeout(earlier.timer);
      void commitDelete(earlier.prompt);
    }
    setPrompts((current) => current?.filter((p) => p.id !== prompt.id) ?? null);
    const timer = window.setTimeout(() => void commitDelete(prompt), UNDO_MS);
    pendingDelete.current = { prompt, timer };
    showToast(
      {
        text: `Deleted “${prompt.name}”`,
        action: {
          label: 'Undo',
          run: () => {
            window.clearTimeout(timer);
            pendingDelete.current = null;
            setPrompts((current) => (current ? [prompt, ...current] : current));
          },
        },
      },
      UNDO_MS,
    );
  };

  const renameFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (view.type !== 'folder' || folderRename === null) return;
    const name = folderRename.trim();
    setFolderRename(null);
    if (!name || name === view.folder) return;
    try {
      await ApiClient.renameFolder(view.folder, name);
      await load(true);
      notifyLibraryChanged();
      router.replace(libraryHref({ type: 'folder', folder: name }));
      showToast({ text: `Renamed the folder to ${name}` });
    } catch {
      showToast({ text: 'Could not rename the folder. Try again.' });
    }
  };

  const removeFolder = async () => {
    if (view.type !== 'folder') return;
    setFolderRemoveOpen(false);
    try {
      const result = await ApiClient.removeFolder(view.folder);
      await load(true);
      notifyLibraryChanged();
      router.replace(libraryHref({ type: 'unfiled' }));
      showToast({
        text: `Removed ${view.folder}. ${result.prompt_count} prompt${result.prompt_count === 1 ? '' : 's'} moved to Unfiled.`,
      });
    } catch {
      showToast({ text: 'Could not remove the folder. Try again.' });
    }
  };

  const folders = useMemo(
    () => [...new Set((prompts ?? []).map((p) => p.folder).filter(Boolean) as string[])].sort(),
    [prompts],
  );
  return {
    router,
    view,
    title,
    prompts,
    loadError,
    search,
    setSearch,
    layout,
    setLayout,
    renamingId,
    setRenamingId,
    menuId,
    setMenuId,
    folderMenuOpen,
    setFolderMenuOpen,
    moving,
    setMoving,
    folderRename,
    setFolderRename,
    folderRemoveOpen,
    setFolderRemoveOpen,
    toast,
    setToast,
    load,
    inView,
    visible,
    toggleFavorite,
    copyTemplate,
    rename,
    move,
    duplicate,
    remove,
    renameFolder,
    removeFolder,
    folders,
  };
}
