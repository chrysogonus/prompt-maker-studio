/**
 * The library is the home page: every saved prompt, narrowed by the sidebar to
 * favourites, a folder, or unfiled prompts, newest edits first. Copying a
 * template is one click; everything else sits in each prompt's menu.
 */

'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import {
  CopyIcon,
  FavoriteIcon,
  GridViewIcon,
  ListViewIcon,
  MoreIcon,
  SearchIcon,
} from '@/components/ui/icon';
import { ApiClient } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import { pageTitle } from '@/lib/branding';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import {
  RECOVERED_HISTORY_FOLDER,
  libraryHref,
  viewFromParams,
  viewTitle,
} from '@/lib/libraryViews';
import { relativeTime } from '@/lib/relativeTime';
import { variablesIn } from '@/lib/sections';
import { STARTER_TEMPLATES } from '@/lib/starterTemplates';
import type { PromptHistoryResponse } from '@/types/prompt';
import styles from './page.module.css';

const UNDO_MS = 5000;

type Prompt = PromptHistoryResponse;

interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

/** The first section with real text, so a prompt opening with {{email}} still says something. */
function excerpt(prompt: Prompt): string {
  const section =
    prompt.fields.find((f) => f.content.trim() && !/^\s*\{\{[^}]+\}\}\s*$/.test(f.content)) ??
    prompt.fields[0];
  return section ? section.content.replace(/\s+/g, ' ').trim() : '';
}

function editedAt(prompt: Prompt): string {
  return prompt.updated_at ?? prompt.created_at;
}

function LibraryContent() {
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

  const load = useCallback(async () => {
    try {
      setPrompts(await ApiClient.getSavedPrompts());
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load your prompts.');
    }
  }, []);

  useEffect(() => {
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
      await load();
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
      await load();
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

  const promptMenu = (prompt: Prompt) => (
    <div className={styles.menuWrap} data-menu>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`More actions for ${prompt.name}`}
        aria-haspopup="menu"
        aria-expanded={menuId === prompt.id}
        onClick={(e) => {
          e.stopPropagation();
          setMenuId(menuId === prompt.id ? null : prompt.id);
        }}
      >
        <MoreIcon tone="inherit" />
      </button>
      {menuId === prompt.id && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" onClick={() => copyTemplate(prompt)}>
            Copy template
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuId(null);
              setRenamingId(prompt.id);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuId(null);
              setMoving({ prompt, folder: prompt.folder ?? '' });
            }}
          >
            Move to folder…
          </button>
          <button type="button" role="menuitem" onClick={() => duplicate(prompt)}>
            Duplicate
          </button>
          <button type="button" role="menuitem" className={styles.danger} onClick={() => remove(prompt)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );

  const name = (prompt: Prompt) =>
    renamingId === prompt.id ? (
      <input
        className={styles.renameInput}
        defaultValue={prompt.name ?? ''}
        aria-label="Prompt name"
        maxLength={100}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => rename(prompt, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setRenamingId(null);
        }}
      />
    ) : (
      <Link href={`/editor/${prompt.id}`} className={styles.name}>
        {prompt.name}
      </Link>
    );

  const star = (prompt: Prompt) => (
    <button
      type="button"
      className={styles.star}
      aria-pressed={prompt.is_favorite}
      aria-label={prompt.is_favorite ? `Remove ${prompt.name} from favorites` : `Add ${prompt.name} to favorites`}
      onClick={(e) => {
        e.stopPropagation();
        void toggleFavorite(prompt);
      }}
    >
      <FavoriteIcon tone="inherit" />
    </button>
  );

  // Clicking anywhere on a row opens it; buttons and the name link handle their own clicks.
  const openOnClick = (prompt: Prompt) => (event: React.MouseEvent) => {
    if ((event.target as Element).closest('button, a, input')) return;
    router.push(`/editor/${prompt.id}`);
  };

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <div className={styles.empty} role="alert">
        <h2>Your prompts could not be loaded</h2>
        <p>{loadError}</p>
        <Button variant="secondary" onClick={load}>
          Try again
        </Button>
      </div>
    );
  } else if (prompts === null) {
    body = <p className={styles.loading}>Loading your prompts…</p>;
  } else if (visible.length === 0 && search.trim()) {
    body = (
      <div className={styles.empty}>
        <h2>No prompts match “{search.trim()}”</h2>
        <p>Search looks at names, folders and section text.</p>
        <Button variant="secondary" onClick={() => setSearch('')}>
          Clear search
        </Button>
      </div>
    );
  } else if (visible.length === 0 && view.type === 'favorites') {
    body = (
      <div className={styles.empty}>
        <h2>No favorites yet</h2>
        <p>Star the prompts you use most and they’ll be collected here.</p>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className={styles.empty}>
        <h2>Nothing here</h2>
        <p>No prompts are filed here any more.</p>
        <Link href="/library" className={styles.textLink}>
          Go to all prompts
        </Link>
      </div>
    );
  } else if (layout === 'grid') {
    body = (
      <ul className={styles.grid}>
        {visible.map((prompt) => (
          <li key={prompt.id} className={styles.card} onClick={openOnClick(prompt)}>
            <div className={styles.cardTop}>
              {name(prompt)}
              {star(prompt)}
            </div>
            <p className={styles.cardExcerpt}>{excerpt(prompt)}</p>
            <div className={styles.cardFoot}>
              <span>
                {view.type !== 'folder' && <>{prompt.folder ?? 'Unfiled'}, </>}
                {relativeTime(editedAt(prompt))}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Copy the ${prompt.name} template`}
                onClick={() => copyTemplate(prompt)}
              >
                <CopyIcon tone="inherit" />
              </button>
              {promptMenu(prompt)}
            </div>
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <ul className={styles.list}>
        {visible.map((prompt) => {
          const variables = variablesIn(prompt.fields).length;
          return (
            <li key={prompt.id} className={styles.row} onClick={openOnClick(prompt)}>
              {star(prompt)}
              <div className={styles.rowMain}>
                {name(prompt)}
                <p className={styles.excerpt}>{excerpt(prompt)}</p>
              </div>
              <div className={styles.meta}>
                {view.type !== 'folder' && <span>{prompt.folder ?? 'Unfiled'}</span>}
                <span>{variables ? `${variables} variable${variables === 1 ? '' : 's'}` : 'No variables'}</span>
                <span className={styles.when}>{relativeTime(editedAt(prompt))}</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => copyTemplate(prompt)}
                  aria-label={`Copy the ${prompt.name} template`}
                >
                  <CopyIcon tone="inherit" />
                  Copy template
                </button>
                {promptMenu(prompt)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (prompts !== null && prompts.length === 0 && !loadError) {
    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <h1>Your prompt library is empty</h1>
          <p>
            Save the prompts you keep retyping. Split them into sections, mark the parts that change
            with <code>{'{{variables}}'}</code>, and copy a filled-in version whenever you need it.
          </p>
          <div className={styles.heroActions}>
            <Link href="/editor/new" className={styles.primaryLink}>
              New prompt
            </Link>
            <Link href="/editor/new?import=1" className={styles.secondaryLink}>
              Import text
            </Link>
          </div>
          <h2>Or start from a template</h2>
          <ul className={styles.starters}>
            {STARTER_TEMPLATES.map((template) => (
              <li key={template.id}>
                <Link href={`/editor/new?starter=${template.id}`} className={styles.starter}>
                  <strong>{template.label}</strong>
                  <span>{template.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        {toast && <ToastView toast={toast} onDone={() => setToast(null)} />}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>{title}</h1>
        {view.type === 'folder' && (
          <div className={styles.menuWrap} data-menu>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Actions for the ${view.folder} folder`}
              aria-haspopup="menu"
              aria-expanded={folderMenuOpen}
              onClick={() => setFolderMenuOpen((open) => !open)}
            >
              <MoreIcon tone="inherit" />
            </button>
            {folderMenuOpen && (
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFolderMenuOpen(false);
                    setFolderRename(view.folder);
                  }}
                >
                  Rename folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.danger}
                  onClick={() => {
                    setFolderMenuOpen(false);
                    setFolderRemoveOpen(true);
                  }}
                >
                  Remove folder…
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {view.type === 'folder' && view.folder === RECOVERED_HISTORY_FOLDER && (
        <p className={styles.note}>
          These are unnamed prompts from your old generation history, kept when the History tab was
          retired. Rename the ones worth keeping, move them to a folder, or delete them.
        </p>
      )}

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <SearchIcon tone="inherit" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts"
            aria-label="Search prompts"
          />
        </label>
        <span className={styles.count}>
          {search.trim()
            ? `${visible.length} of ${inView.length}`
            : `${inView.length} prompt${inView.length === 1 ? '' : 's'}`}
        </span>
        <div className={styles.layoutSwitch} role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === 'list'} aria-label="List" onClick={() => setLayout('list')}>
            <ListViewIcon tone="inherit" />
          </button>
          <button type="button" aria-pressed={layout === 'grid'} aria-label="Grid" onClick={() => setLayout('grid')}>
            <GridViewIcon tone="inherit" />
          </button>
        </div>
      </div>

      {body}

      <Dialog isOpen={moving !== null} title="Move to folder" onClose={() => setMoving(null)}>
        {moving && (
          <form className={styles.form} onSubmit={move}>
            <div className={styles.field}>
              <label htmlFor="library-move-folder">Folder</label>
              <input
                id="library-move-folder"
                value={moving.folder}
                onChange={(e) => setMoving({ ...moving, folder: e.target.value })}
                list="library-folders"
                placeholder="Unfiled"
                maxLength={255}
                aria-describedby="library-move-hint"
                autoFocus
              />
              <small id="library-move-hint">
                Leave empty to keep it unfiled. Type a new name to create a folder.
              </small>
            </div>
            <div className={styles.formActions}>
              <Button variant="ghost" onClick={() => setMoving(null)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Move
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog isOpen={folderRename !== null} title="Rename folder" onClose={() => setFolderRename(null)}>
        <form className={styles.form} onSubmit={renameFolder}>
          <div className={styles.field}>
            <label htmlFor="library-folder-name">Name</label>
            <input
              id="library-folder-name"
              value={folderRename ?? ''}
              onChange={(e) => setFolderRename(e.target.value)}
              maxLength={255}
              autoFocus
            />
            <small>Renaming onto an existing folder merges the two.</small>
          </div>
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={() => setFolderRename(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Rename
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        isOpen={folderRemoveOpen}
        title={view.type === 'folder' ? `Remove “${view.folder}”?` : 'Remove folder?'}
        onClose={() => setFolderRemoveOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setFolderRemoveOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={removeFolder}>
              Remove folder
            </Button>
          </>
        }
      >
        <p className={styles.dialogText}>
          Its {inView.length} prompt{inView.length === 1 ? '' : 's'} will move to Unfiled. No prompts
          are deleted.
        </p>
      </Dialog>

      <datalist id="library-folders">
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>

      {toast && <ToastView toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  return (
    <div className={styles.toast} role="status">
      {toast.text}
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
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
