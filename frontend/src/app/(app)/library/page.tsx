/**
 * Library — grid/list of saved prompts with tag filtering and favorites,
 * plus a History tab for the append-only generation log. Usage counts are
 * real Playground run counts, computed server-side per prompt.
 */

'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  FormEvent,
  KeyboardEvent,
  Suspense,
} from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Button, { ButtonLink } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import Tag from '@/components/ui/Tag';
import SegmentedControl from '@/components/ui/SegmentedControl';
import PageHeader from '@/components/ui/PageHeader';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { PromptField } from '@/types/prompt';
import { SavedPrompt } from '@/types/saved-prompt';
import styles from './page.module.css';
import { pageTitle, storageKey } from '@/lib/branding';

const HISTORY_PAGE_SIZE = 20;
const HISTORY_SEARCH_DEBOUNCE_MS = 300;
const DELETE_CONFIRM_TIMEOUT_MS = 4_000;
const DELETE_UNDO_TIMEOUT_MS = 5_000;
const TOAST_TIMEOUT_MS = 7_000;

type ViewMode = 'grid' | 'list';
type LibraryTab = 'saved' | 'history';

const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
] as const;

function toSavedPrompt(p: {
  id: number;
  name: string | null;
  fields: PromptField[];
  generated_prompt: string;
  created_at: string;
  updated_at?: string | null;
  folder?: string | null;
  is_favorite?: boolean;
  tags?: string[] | null;
  run_count: number;
}): SavedPrompt {
  const autoTitleSource =
    p.fields.find((field) => ['title', 'goal', 'task'].includes(field.name.toLowerCase()))
      ?.content ?? p.fields.find((field) => field.content.trim())?.content;
  const autoTitle = autoTitleSource?.replace(/\s+/g, ' ').trim();
  return {
    id: String(p.id),
    name: p.name ?? (autoTitle ? autoTitle.slice(0, 72) : 'Unnamed generation'),
    promptId: p.id,
    fields: p.fields,
    generatedPrompt: p.generated_prompt,
    savedAt: p.created_at,
    updatedAt: p.updated_at ?? null,
    folder: p.folder ?? null,
    isFavorite: p.is_favorite ?? false,
    tags: p.tags ?? [],
    runCount: p.run_count,
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

function LibraryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { currentUser: signedInAs } = useAuth();

  const initialTab = (searchParams.get('tab') as LibraryTab) || 'saved';
  const initialQuery = searchParams.get('q') || '';
  const initialTag = searchParams.get('tag') || null;

  const [tab, setTabState] = useState<LibraryTab>(initialTab);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const persistedViewModeRef = useRef<ViewMode>('grid');
  const selectedViewModeRef = useRef<ViewMode>('grid');
  const viewModeTouchedRef = useRef(false);
  const viewPreferenceMutationRef = useRef<Promise<void>>(Promise.resolve());
  const [searchQuery, setSearchQueryState] = useState(initialQuery);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  const [savedLoadError, setSavedLoadError] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [activeTag, setActiveTagState] = useState<string | null>(initialTag);

  const updateQueryParams = useCallback((newTab: LibraryTab, newQ: string, newTag: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newTab && newTab !== 'saved') {
      params.set('tab', newTab);
    } else {
      params.delete('tab');
    }
    if (newQ) {
      params.set('q', newQ);
    } else {
      params.delete('q');
    }
    if (newTag) {
      params.set('tag', newTag);
    } else {
      params.delete('tag');
    }
    const queryString = params.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ''}`);
  }, [pathname, router, searchParams]);

  const setTab = (newTab: LibraryTab) => {
    setTabState(newTab);
    updateQueryParams(newTab, searchQuery, activeTag);
  };

  const setSearchQuery = (newQ: string) => {
    setSearchQueryState(newQ);
    updateQueryParams(tab, newQ, activeTag);
  };

  const setActiveTag = (newTag: string | null) => {
    setActiveTagState(newTag);
    updateQueryParams(tab, searchQuery, newTag);
  };

  // Clearing both filters must be a single URL update: calling setSearchQuery
  // and setActiveTag back to back would each build the query string from the
  // other filter's not-yet-updated state, re-adding the param just removed.
  const clearFilters = () => {
    setSearchQueryState('');
    setActiveTagState(null);
    updateQueryParams(tab, '', null);
  };

  useEffect(() => {
    const currentTab = (searchParams.get('tab') as LibraryTab) || 'saved';
    const currentQ = searchParams.get('q') || '';
    const currentTag = searchParams.get('tag') || null;

    setTabState(currentTab);
    setSearchQueryState(currentQ);
    setActiveTagState(currentTag);
  }, [searchParams]);

  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    deletePromptId?: number;
    actionExpiresAt?: number;
  } | null>(null);
  const [toastClock, setToastClock] = useState(() => Date.now());
  const toastRef = useRef<typeof toast>(null);
  const toastDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmingDeleteRef = useRef<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const handleViewModeChange = (nextView: ViewMode) => {
    if (nextView === selectedViewModeRef.current) return;

    viewModeTouchedRef.current = true;
    selectedViewModeRef.current = nextView;
    setViewMode(nextView);
    setError('');

    const mutation = viewPreferenceMutationRef.current.then(() =>
      AuthService.updateProfile({ default_library_view: nextView }),
    );
    viewPreferenceMutationRef.current = mutation.then(
      (updatedUser) => {
        persistedViewModeRef.current = updatedUser.default_library_view ?? nextView;
      },
      (err) => {
        // A later selection may already be queued. Only roll back when the
        // failed request still represents what the user sees.
        if (selectedViewModeRef.current === nextView) {
          selectedViewModeRef.current = persistedViewModeRef.current;
          setViewMode(persistedViewModeRef.current);
          setError(
            err instanceof Error ? err.message : 'Failed to save the Library view preference.',
          );
        }
      },
    );
  };

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const pendingDeleteRef = useRef<{
    prompt: SavedPrompt;
    wasSaved: boolean;
    wasHistory: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const [historyPrompts, setHistoryPrompts] = useState<SavedPrompt[]>([]);
  const [historySearchInput, setHistorySearchInput] = useState('');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const savedRequestIdRef = useRef(0);
  const isFirstRenderHistoryRef = useRef(true);

  const dismissToast = useCallback(() => {
    if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);
    toastDismissTimerRef.current = null;
    toastRef.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback(
    (nextToast: NonNullable<typeof toast>, durationMs: number | null = TOAST_TIMEOUT_MS) => {
      if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);
      toastRef.current = nextToast;
      setToast(nextToast);
      if (durationMs !== null) {
        toastDismissTimerRef.current = setTimeout(dismissToast, durationMs);
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    if (!toast?.actionExpiresAt) return;
    setToastClock(Date.now());
    const timer = setInterval(() => setToastClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [toast?.actionExpiresAt]);

  useEffect(
    () => () => {
      if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);
      if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    },
    [],
  );

  const loadSavedPrompts = useCallback(async () => {
    const requestId = ++savedRequestIdRef.current;
    setIsLoadingSaved(true);
    setSavedLoadError('');
    try {
      const data = await ApiClient.getSavedPrompts();
      if (requestId !== savedRequestIdRef.current) return;
      setSavedPrompts(data.map(toSavedPrompt));
    } catch (err) {
      console.error('Failed to load saved prompts:', err);
      if (requestId !== savedRequestIdRef.current) return;
      setSavedLoadError(
        err instanceof Error ? err.message : 'Saved prompts could not be loaded.',
      );
    } finally {
      if (requestId === savedRequestIdRef.current) setIsLoadingSaved(false);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      setAvailableTags(await ApiClient.getTags());
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  }, []);

  const loadHistoryPrompts = useCallback(async (search: string = '') => {
    try {
      const data = await ApiClient.getHistory(HISTORY_PAGE_SIZE, 0, search);
      setHistoryPrompts(data.map(toSavedPrompt));
      setHistoryHasMore(data.length === HISTORY_PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load history prompts:', err);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    document.title = pageTitle('Library');
    return () => {
      document.title = pageTitle();
    };
  }, [searchParams]);

  useEffect(() => {
    AuthService.getCurrentUser()
      .then((user) => {
        if (!user.default_library_view) return;
        persistedViewModeRef.current = user.default_library_view;
        if (!viewModeTouchedRef.current) {
          selectedViewModeRef.current = user.default_library_view;
          setViewMode(user.default_library_view);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSavedPrompts();
  }, [loadSavedPrompts]);

  useEffect(() => {
    if (isFirstRenderHistoryRef.current) {
      isFirstRenderHistoryRef.current = false;
      loadHistoryPrompts(historySearchInput);
      return;
    }
    const handle = setTimeout(() => {
      loadHistoryPrompts(historySearchInput);
    }, HISTORY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [historySearchInput, loadHistoryPrompts]);

  useEffect(() => {
    // A delete inside its undo window hasn't hit the server yet; without this
    // flush a refresh or tab close silently drops it and the prompt reappears.
    const flushPendingDelete = () => {
      const pending = pendingDeleteRef.current;
      if (!pending?.prompt.promptId) return;
      clearTimeout(pending.timer);
      pendingDeleteRef.current = null;
      ApiClient.flushDeletePrompt(pending.prompt.promptId);
    };
    window.addEventListener('pagehide', flushPendingDelete);
    return () => window.removeEventListener('pagehide', flushPendingDelete);
  }, []);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    const disarmOnOutsideClick = (event: MouseEvent) => {
      let target = event.target;
      if (target instanceof Node && target.nodeType === 3) {
        target = target.parentElement;
      }
      if (target instanceof Element && target.closest(`[data-delete-id="${confirmingDeleteId}"]`)) {
        return;
      }
      confirmingDeleteRef.current = null;
      setConfirmingDeleteId(null);
    };
    // Delay adding the event listener to avoid registering during the current event bubble
    const timer = setTimeout(() => {
      document.addEventListener('click', disarmOnOutsideClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', disarmOnOutsideClick);
    };
  }, [confirmingDeleteId]);

  const filteredSaved = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return savedPrompts.filter((p) => {
      const matchesTag = !activeTag || p.tags?.includes(activeTag);
      const matchesText =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.generatedPrompt.toLowerCase().includes(q) ||
        (p.folder ?? '').toLowerCase().includes(q) ||
        (p.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
      return matchesTag && matchesText;
    });
  }, [activeTag, savedPrompts, searchQuery]);

  const handleLoadMoreHistory = async () => {
    setIsLoadingMoreHistory(true);
    try {
      const data = await ApiClient.getHistory(
        HISTORY_PAGE_SIZE,
        historyPrompts.length,
        historySearchInput
      );
      setHistoryPrompts((prev) => [...prev, ...data.map(toSavedPrompt)]);
      setHistoryHasMore(data.length === HISTORY_PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load more history:', err);
    } finally {
      setIsLoadingMoreHistory(false);
    }
  };

  const handleSelectPrompt = (promptId: number | null) => {
    if (promptId !== null) router.push(`/editor/${promptId}`);
  };

  // Activates a clickable row on Enter/Space, keeping it keyboard-reachable
  // like the grid's Card component. Ignores keydowns that bubbled up from a
  // nested interactive element (rename input, favorite/action buttons).
  const handleRowKeyDown = (
    e: KeyboardEvent<HTMLDivElement>,
    onActivate: () => void
  ) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  const handleToggleFavorite = async (p: SavedPrompt) => {
    if (!p.promptId) return;
    try {
      // No `last_updated_at`, deliberately. Favouriting is per-row metadata
      // with last-writer-wins semantics — there is nothing to merge, so a
      // conflict prompt would be noise. It would also fire spuriously: the star
      // has no in-flight guard, so a double-click sends two mutations built
      // from the same captured `p`, and the second would be rejected for a
      // conflict the user caused with their own first click. Content edits in
      // the editor keep the check.
      const updated = await ApiClient.updatePrompt(p.promptId, {
        is_favorite: !p.isFavorite,
      });
      setSavedPrompts((prev) => prev.map((sp) => (sp.id === p.id ? toSavedPrompt(updated) : sp)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite.');
    }
  };

  const commitPendingDelete = useCallback(async () => {
    const pending = pendingDeleteRef.current;
    if (!pending?.prompt.promptId) return;
    pendingDeleteRef.current = null;
    try {
      await ApiClient.deletePrompt(pending.prompt.promptId);
      if (toastRef.current?.deletePromptId === pending.prompt.promptId) {
        showToast({ message: `${pending.prompt.name} deleted.` }, 2_500);
      }
    } catch (err) {
      if (pending.wasSaved) setSavedPrompts((prev) => [pending.prompt, ...prev]);
      if (pending.wasHistory) setHistoryPrompts((prev) => [pending.prompt, ...prev]);
      setError(err instanceof Error ? err.message : 'Failed to delete prompt.');
      if (toastRef.current?.deletePromptId === pending.prompt.promptId) dismissToast();
    }
  }, [dismissToast, showToast]);

  const undoPendingDelete = () => {
    const pending = pendingDeleteRef.current;
    if (!pending) {
      showToast({ message: 'Too late to undo — the prompt was deleted.' });
      return;
    }
    clearTimeout(pending.timer);
    pendingDeleteRef.current = null;
    if (pending.wasSaved) setSavedPrompts((prev) => [pending.prompt, ...prev]);
    if (pending.wasHistory) setHistoryPrompts((prev) => [pending.prompt, ...prev]);
    showToast({ message: 'Deletion undone.' });
  };

  const handleDelete = (p: SavedPrompt, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!p.promptId) return;

    const isConfirming = confirmingDeleteRef.current === p.id;
    if (!isConfirming) {
      confirmingDeleteRef.current = p.id;
      setConfirmingDeleteId(p.id);

      if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = setTimeout(() => {
        if (confirmingDeleteRef.current === p.id) {
          confirmingDeleteRef.current = null;
          setConfirmingDeleteId(null);
        }
      }, DELETE_CONFIRM_TIMEOUT_MS);
      return;
    }

    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    confirmingDeleteRef.current = null;
    setConfirmingDeleteId(null);
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      void commitPendingDelete();
    }
    const wasSaved = savedPrompts.some((saved) => saved.id === p.id);
    const wasHistory = historyPrompts.some((historyPrompt) => historyPrompt.id === p.id);
    setSavedPrompts((prev) => prev.filter((sp) => sp.id !== p.id));
    setHistoryPrompts((prev) => prev.filter((sp) => sp.id !== p.id));
    const pending = {
      prompt: p,
      wasSaved,
      wasHistory,
      timer: setTimeout(() => void commitPendingDelete(), DELETE_UNDO_TIMEOUT_MS),
    };
    pendingDeleteRef.current = pending;
    showToast(
      {
        message: `${p.name} deleted.`,
        actionLabel: 'Undo',
        onAction: undoPendingDelete,
        deletePromptId: p.promptId,
        actionExpiresAt: Date.now() + DELETE_UNDO_TIMEOUT_MS,
      },
      null,
    );
  };

  const handleDuplicate = async (p: SavedPrompt) => {
    if (!p.promptId) return;
    if (duplicatingId) return;
    setDuplicatingId(p.id);
    try {
      const copy = await ApiClient.duplicatePrompt(p.promptId);
      setSavedPrompts((prev) => [toSavedPrompt(copy), ...prev]);
      showToast({
        message: `Duplicated as “${copy.name ?? 'Untitled Prompt Duplicate'}”.`,
        actionLabel: 'Open copy',
        onAction: () => router.push(`/editor/${copy.id}`),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate prompt.');
    } finally {
      setDuplicatingId(null);
    }
  };

  const startRename = (p: SavedPrompt) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };

  const commitRename = async (p: SavedPrompt, e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!p.promptId || !trimmed || trimmed === p.name) return;
    try {
      const updated = await ApiClient.updatePrompt(p.promptId, {
        name: trimmed,
        last_updated_at: p.updatedAt || p.savedAt || undefined,
      });
      setSavedPrompts((prev) => prev.map((sp) => (sp.id === p.id ? toSavedPrompt(updated) : sp)));
      const isDuplicateName = savedPrompts.some(
        (sp) => sp.id !== p.id && sp.name.toLowerCase() === trimmed.toLowerCase()
      );
      showToast({
        message: isDuplicateName
          ? `Renamed to “${trimmed}”. Another prompt already uses this name.`
          : `Renamed to “${trimmed}”.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename prompt.');
    }
  };

  const renderFavoriteButton = (p: SavedPrompt) => (
    <button
      type="button"
      className={styles.favoriteButton}
      aria-label={p.isFavorite ? `Unfavorite ${p.name}` : `Favorite ${p.name}`}
      title={p.isFavorite ? 'Unfavorite' : 'Favorite'}
      data-active={!!p.isFavorite}
      onClick={(e) => {
        e.stopPropagation();
        handleToggleFavorite(p);
      }}
    >
      ★
    </button>
  );

  // Every action carries the prompt's name. The visible label stays short, but
  // a whole library of cards otherwise reads as N identical "Delete" buttons in
  // the accessibility tree, with nothing to say which prompt each one destroys.
  const renderCardActions = (p: SavedPrompt) => (
    <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={styles.iconAction}
        onClick={() => startRename(p)}
        title="Rename"
        aria-label={`Rename ${p.name}`}
      >
        Rename
      </button>
      <button
        type="button"
        className={styles.iconAction}
        onClick={() => handleDuplicate(p)}
        title="Duplicate"
        aria-label={`Duplicate ${p.name}`}
        disabled={duplicatingId !== null}
      >
        {duplicatingId === p.id ? 'Duplicating…' : 'Duplicate'}
      </button>
      <button
        type="button"
        className={styles.iconActionDanger}
        data-delete-id={p.id}
        onClick={(e) => handleDelete(p, e)}
        title={confirmingDeleteId === p.id ? 'Confirm deletion' : 'Delete'}
        aria-label={
          confirmingDeleteId === p.id ? `Confirm delete ${p.name}?` : `Delete ${p.name}`
        }
      >
        {confirmingDeleteId === p.id ? 'Confirm delete?' : 'Delete'}
      </button>
    </div>
  );

  return (
    <div className={styles.library}>
      <PageHeader
        title="Prompt library"
        actions={
          <ButtonLink
            href="/editor/new"
            variant="primary"
            // `getCurrentUser()` is async, so this used to build the key
            // `draft:[object Promise]` from the unawaited promise — a key nothing
            // ever writes — and silently left the previous draft in place, so
            // "New prompt" opened the editor pre-filled with the old one.
            onClick={() => {
              if (signedInAs) {
                localStorage.removeItem(storageKey(`draft:${signedInAs}`));
              }
            }}
          >
            + New prompt
          </ButtonLink>
        }
      />

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}
      <div className={styles.liveRegion} role="status" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={styles.toast}>
            <span>{toast.message}</span>
            {toast.actionExpiresAt && (
              <span className={styles.toastCountdown}>
                {Math.max(0, Math.ceil((toast.actionExpiresAt - toastClock) / 1000))}s
              </span>
            )}
            {toast.actionLabel && toast.onAction && (
              <button type="button" onClick={toast.onAction}>{toast.actionLabel}</button>
            )}
            <button type="button" aria-label="Dismiss notification" onClick={dismissToast}>×</button>
          </div>
        )}
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={styles.tabButton}
          data-active={tab === 'saved'}
          onClick={() => setTab('saved')}
          disabled={!isHydrated}
        >
          Saved ({isLoadingSaved ? '…' : savedLoadError ? '!' : `${filteredSaved.length} / ${savedPrompts.length}`})
        </button>
        <button
          type="button"
          className={styles.tabButton}
          data-active={tab === 'history'}
          onClick={() => setTab('history')}
          disabled={!isHydrated}
        >
          History
        </button>
      </div>

      {tab === 'saved' && (
        <>
          <div className={styles.controls}>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter…"
              className={styles.search}
              aria-label="Filter saved prompts"
            />
            <div className={styles.spacer} />
            <SegmentedControl
              aria-label="View"
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={handleViewModeChange}
            />
          </div>

          {availableTags.length > 0 && (
            <div className={styles.tagRow}>
              <button
                type="button"
                className={styles.tagFilter}
                data-active={activeTag === null}
                onClick={() => setActiveTag(null)}
              >
                All
              </button>
              {availableTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={styles.tagFilter}
                  data-active={activeTag === t}
                  onClick={() => setActiveTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {(searchQuery.trim() || activeTag) && (
            <div className={styles.activeFilters} aria-label="Active filters">
              <span>Showing {filteredSaved.length} of {savedPrompts.length}</span>
              {searchQuery.trim() && <Tag>Search: {searchQuery.trim()}</Tag>}
              {activeTag && <Tag>Tag: {activeTag}</Tag>}
              <button type="button" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {isLoadingSaved ? (
            <div className={styles.empty}>Loading saved prompts…</div>
          ) : savedLoadError ? (
            <div className={styles.empty} role="alert">
              <span>Saved prompts could not be loaded. Your prompts have not been deleted.</span>
              <Button variant="secondary" onClick={loadSavedPrompts}>
                Retry
              </Button>
            </div>
          ) : filteredSaved.length === 0 ? (
            <div className={styles.empty}>
              {searchQuery.trim() || activeTag
                ? 'No saved prompts match the current filters.'
                : 'No saved prompts yet.'}
              {(searchQuery.trim() || activeTag) && (
                <button
                  type="button"
                  className={styles.clearFiltersButton}
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div className={styles.grid}>
              {filteredSaved.map((p) => (
                <Card
                  key={p.id}
                  interactive
                  role="group"
                  className={styles.card}
                  onClick={() => handleSelectPrompt(p.promptId)}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.folderLabel}>{p.folder || ' '}</div>
                    {renderFavoriteButton(p)}
                  </div>
                  {renamingId === p.id ? (
                    <form onSubmit={(e) => commitRename(p, e)} onClick={(e) => e.stopPropagation()}>
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(p)}
                        onKeyDown={(e) => e.key === 'Escape' && setRenamingId(null)}
                        maxLength={100}
                      />
                    </form>
                  ) : (
                    <h2 className={styles.cardTitle} title={p.name}>{p.name}</h2>
                  )}
                  <div className={styles.cardDesc}>{p.generatedPrompt.slice(0, 140)}</div>
                  {p.tags && p.tags.length > 0 && (
                    <div className={styles.cardTags}>
                      {p.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                  )}
                  <div className={styles.cardFooter}>
                    <span>{p.runCount} {p.runCount === 1 ? 'run' : 'runs'}</span>
                    <span>Edited {formatDate(p.updatedAt ?? p.savedAt)}</span>
                  </div>
                  {renderCardActions(p)}
                </Card>
              ))}
            </div>
          ) : (
            <div className={styles.list}>
              {filteredSaved.map((p) => (
                <div
                  key={p.id}
                  className={styles.listRow}
                  role="group"
                  tabIndex={0}
                  onClick={() => handleSelectPrompt(p.promptId)}
                  onKeyDown={(e) => handleRowKeyDown(e, () => handleSelectPrompt(p.promptId))}
                >
                  <div className={styles.listMain}>
                    {renamingId === p.id ? (
                      <form onSubmit={(e) => commitRename(p, e)} onClick={(e) => e.stopPropagation()}>
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(p)}
                          onKeyDown={(e) => e.key === 'Escape' && setRenamingId(null)}
                          maxLength={100}
                        />
                      </form>
                    ) : (
                      <h2 className={styles.listTitle} title={p.name}>{p.name}</h2>
                    )}
                    <div className={styles.listSub}>
                      {p.folder ? `${p.folder} · ` : ''}Edited {formatDate(p.updatedAt ?? p.savedAt)}
                    </div>
                  </div>
                  <div className={styles.listTags}>
                    {(p.tags ?? []).map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                  {renderFavoriteButton(p)}
                  {renderCardActions(p)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          <Input
            value={historySearchInput}
            onChange={(e) => setHistorySearchInput(e.target.value)}
            placeholder="Search history…"
            aria-label="Search history"
            className={styles.search}
          />
          {historyPrompts.length === 0 ? (
            <div className={styles.empty}>
              {historySearchInput.trim() ? 'No history matches your search.' : 'No history yet.'}
            </div>
          ) : (
            <div className={styles.list}>
              {historyPrompts.map((p) => (
                <div
                  key={p.id}
                  className={styles.listRow}
                  role="group"
                  tabIndex={0}
                  onClick={() => handleSelectPrompt(p.promptId)}
                  onKeyDown={(e) => handleRowKeyDown(e, () => handleSelectPrompt(p.promptId))}
                >
                  <div className={styles.listMain}>
                    <h2 className={styles.listTitle} title={p.name}>{p.name}</h2>
                    <div className={styles.listSub}>{formatDate(p.savedAt)}</div>
                  </div>
                  <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.iconActionDanger}
                      data-delete-id={p.id}
                      onClick={(e) => handleDelete(p, e)}
                      title={confirmingDeleteId === p.id ? 'Confirm deletion' : 'Delete'}
                      aria-label={
                        confirmingDeleteId === p.id
                          ? `Confirm delete ${p.name}?`
                          : `Delete ${p.name}`
                      }
                    >
                      {confirmingDeleteId === p.id ? 'Confirm delete?' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {historyHasMore && (
            <Button variant="secondary" onClick={handleLoadMoreHistory} disabled={isLoadingMoreHistory}>
              {isLoadingMoreHistory ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryContent />
    </Suspense>
  );
}
