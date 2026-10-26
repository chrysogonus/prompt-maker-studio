'use client';

import { Suspense, useMemo, type KeyboardEvent } from 'react';
import Link from 'next/link';

import Button, { ButtonLink } from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import {
  CopyIcon,
  FavoriteIcon,
  GridViewIcon,
  ListViewIcon,
  MoreIcon,
  SearchIcon,
} from '@/components/ui/icon';

import { hasUnsavedDraft } from '@/features/editor/editorState';
import { useAuth } from '@/lib/auth-context';
import { RECOVERED_HISTORY_FOLDER } from '@/lib/libraryViews';
import { relativeTime } from '@/lib/relativeTime';
import { splitVariables, variablesIn } from '@/lib/sections';
import { STARTER_TEMPLATES } from '@/lib/starterTemplates';

import styles from './LibraryPage.module.css';
import type { Toast } from './libraryState';
import { useLibrary } from './useLibrary';
import ImportPrompts from './ImportPrompts';
import { Prompt, excerpt, editedAt, searchMatch } from './libraryState';

const variableLabel = (count: number) => (count ? `${count} variable${count === 1 ? '' : 's'}` : 'No variables');
// Untested prompts say nothing: most prompts are never evaluated.
const testLabel = (prompt: Prompt) =>
  prompt.eval_status === 'current' ? (prompt.eval_score == null ? 'Tested' : `Tested · ${Math.round(prompt.eval_score)}/100`)
    : prompt.eval_status === 'stale' ? 'Tests out of date' : null;

function LibraryContent() {
  const {
    sort, setSort, selected, toggleSelected, selectedPrompts, setSelected,
    batchFolder, setBatchFolder, batchBusy, batchResult, moveSelected, addImported,
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
    deleteSelected,
    renameFolder,
    removeFolder,
    folders,
  } = useLibrary();
  const { currentUser } = useAuth();
  // Prompts with unsaved edits in this browser, read once per load rather than on every keystroke.
  const drafts = useMemo(() => new Set(currentUser ? (prompts ?? []).filter((prompt) => hasUnsavedDraft(currentUser, prompt)).map((prompt) => prompt.id) : []), [currentUser, prompts]);
  const draftBadge = (prompt: Prompt) => drafts.has(prompt.id) && <span className={styles.draft}>Unsaved draft</span>;

  /** Text with its variable chips intact; a match inside a {{variable}} marks the whole chip. */
  const snippet = (before: string, match = '', after = '') => {
    const [from, to] = [before.length, before.length + match.length];
    let end = 0;
    return splitVariables(before + match + after).flatMap((part, i) => {
      const start = end;
      end += part.text.length;
      if (part.kind === 'variable') {
        const chip = <span key={i} className={styles.snippetVariable}>{part.text}</span>;
        return start < to && end > from ? <mark key={i}>{chip}</mark> : chip;
      }
      const [a, b] = [Math.max(from, start) - start, Math.min(to, end) - start];
      return a < b ? [part.text.slice(0, a), <mark key={i}>{part.text.slice(a, b)}</mark>, part.text.slice(b)] : [part.text];
    });
  };

  const preview = (prompt: Prompt) => {
    const match = searchMatch(prompt, search);
    return match
      ? <><strong>{match.label}:</strong> {snippet(match.before, match.match, match.after)}</>
      : snippet(excerpt(prompt));
  };

  const selection = (prompt: Prompt) => (
    <label className={styles.selection}>
      <input type="checkbox" aria-label={`Select ${prompt.name}`} checked={selected.includes(prompt.id)} disabled={batchBusy} onChange={() => toggleSelected(prompt.id)} />
    </label>
  );

  /** Arrow keys, Home and End move through an open menu's items, as Tab already does. */
  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(`.${styles.menu} button`)];
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length : at) - 1;
    items[next].focus();
  };

  const promptMenu = (prompt: Prompt) => (
    <div className={styles.menuWrap} data-menu onKeyDown={menuKeys}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`More actions for ${prompt.name}`}
        aria-expanded={menuId === prompt.id}
        onClick={(e) => {
          e.stopPropagation();
          setMenuId(menuId === prompt.id ? null : prompt.id);
        }}
      >
        <MoreIcon tone="inherit" />
      </button>
      {menuId === prompt.id && (
        <div className={styles.menu}>
          <button type="button" onClick={() => copyTemplate(prompt)}>
            Copy template
          </button>
          {prompt.fields.length === 1
            ? <button type="button" onClick={() => copyTemplate(prompt, false)}>Copy with section tags</button>
            : <button type="button" onClick={() => copyTemplate(prompt, true)}>Copy as plain text</button>}
          <button
            type="button"
            onClick={() => {
              setMenuId(null);
              setRenamingId(prompt.id);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuId(null);
              setMoving({ prompt, folder: prompt.folder ?? '' });
            }}
          >
            Move to folder…
          </button>
          <button type="button" onClick={() => duplicate(prompt)}>
            Duplicate
          </button>
          <button type="button" className={styles.danger} onClick={() => remove(prompt)}>
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
      aria-label={prompt.is_favorite ? `Remove ${prompt.name} from favourites` : `Add ${prompt.name} to favourites`}
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
    if ((event.target as Element).closest('button, a, input, label')) return;
    router.push(`/editor/${prompt.id}`);
  };

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <div className={styles.empty} role="alert">
        <h2>Your prompts could not be loaded</h2>
        <p>{loadError}</p>
        <Button variant="secondary" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  } else if (prompts === null) {
    body = <p className={styles.loading}>Loading your prompts…</p>;
  } else if (visible.length === 0 && search.trim()) {
    // Search narrows the current view, so say when prompts elsewhere match.
    const elsewhere = view.type === 'all' ? 0 : prompts.filter((prompt) => searchMatch(prompt, search) !== null).length;
    body = (
      <div className={styles.empty}>
        <h2>No prompts match “{search.trim()}”</h2>
        <p>
          {elsewhere
            ? `${elsewhere} ${elsewhere === 1 ? 'prompt matches' : 'prompts match'} elsewhere in your library.`
            : 'Search looks at names, folders and section text.'}
        </p>
        <div className={styles.emptyActions}>
          {elsewhere > 0 && (
            <ButtonLink variant="primary" href={`/library?${new URLSearchParams({ q: search.trim() })}`}>
              Search all prompts
            </ButtonLink>
          )}
          <Button variant="secondary" onClick={() => setSearch('')}>
            Clear search
          </Button>
        </div>
      </div>
    );
  } else if (visible.length === 0 && view.type === 'favorites') {
    body = (
      <div className={styles.empty}>
        <h2>No favourites yet</h2>
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
              {selection(prompt)}
              {name(prompt)}
              {star(prompt)}
            </div>
            <p className={search.trim() ? styles.searchExcerpt : styles.cardExcerpt}>{preview(prompt)}</p>
            <div className={styles.cardMeta}>
              {view.type !== 'folder' && <span className={styles.folder}>{prompt.folder ?? 'Unfiled'}</span>}
              <span>{variableLabel(variablesIn(prompt.fields).length)}</span>
              {draftBadge(prompt)}
              {testLabel(prompt) && <span>{testLabel(prompt)}</span>}
              <span className={styles.when}>{relativeTime(editedAt(prompt))}</span>
            </div>
            <div className={styles.cardFoot}>
              {variablesIn(prompt.fields).length > 0 && (
                <Link className={styles.copyButton} href={`/editor/${prompt.id}?mode=filled`}>Fill and copy</Link>
              )}
              <button
                type="button"
                className={styles.copyButton}
                aria-label={`Copy the ${prompt.name} template`}
                onClick={() => copyTemplate(prompt)}
              >
                <CopyIcon tone="inherit" />
                Copy template
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
              <div className={styles.rowControls}>{selection(prompt)}{star(prompt)}</div>
              <div className={styles.rowMain}>
                {name(prompt)}
                <p className={search.trim() ? styles.searchExcerpt : styles.excerpt}>{preview(prompt)}</p>
                <div className={styles.meta}>
                  {view.type !== 'folder' && <span className={styles.folder}>{prompt.folder ?? 'Unfiled'}</span>}
                  <span>{variableLabel(variables)}</span>
                  {draftBadge(prompt)}
                  {testLabel(prompt) && <span>{testLabel(prompt)}</span>}
                  <span className={styles.when}>{relativeTime(editedAt(prompt))}</span>
                </div>
              </div>
              <div className={styles.actions}>
                {variables > 0 && (
                  <Link className={styles.copyButton} href={`/editor/${prompt.id}?mode=filled`}>Fill and copy</Link>
                )}
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
          <p>
            Already keep prompts in Notion, Obsidian or Markdown files? Add them here; you review
            everything before it is saved.
          </p>
          <div className={styles.heroActions}>
            <ImportPrompts onCreated={addImported} folders={folders} primary />
            <Link href="/editor/new" className={styles.secondaryLink}>
              New prompt
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
            <li>
              <Link href="/gallery" className={styles.starter}>
                <strong>Browse the template gallery</strong>
                <span>24 more templates for coding agents, images, writing and everyday work.</span>
              </Link>
            </li>
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
        <ImportPrompts onCreated={addImported} folders={folders} existing={prompts ?? []} />
        {view.type === 'folder' && (
          <div className={styles.menuWrap} data-menu onKeyDown={menuKeys}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Actions for the ${view.folder} folder`}
              aria-expanded={folderMenuOpen}
              onClick={() => setFolderMenuOpen((open) => !open)}
            >
              <MoreIcon tone="inherit" />
            </button>
            {folderMenuOpen && (
              <div className={styles.menu}>
                <button
                  type="button"
                  onClick={() => {
                    setFolderMenuOpen(false);
                    setFolderRename(view.folder);
                  }}
                >
                  Rename folder
                </button>
                <button
                  type="button"
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
        <select aria-label="Sort prompts" className={styles.sort} value={sort} onChange={event => setSort(event.target.value as 'recent' | 'title')}>
          <option value="recent">Recently edited</option>
          <option value="title">Title A–Z</option>
        </select>
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

      {visible.length > 0 && <div className={styles.selectionBar}>
        <label className={styles.selectVisible}>
          <input type="checkbox" disabled={batchBusy} checked={visible.every(prompt => selected.includes(prompt.id))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map(prompt => prompt.id)])] : selected.filter(id => !visible.some(prompt => prompt.id === id)))} />
          Select visible prompts
        </label>
        {selectedPrompts.length > 0 && <Button variant="ghost" disabled={batchBusy} onClick={() => setSelected([])}>Clear selection</Button>}
      </div>}
      {selectedPrompts.length > 0 && <form className={styles.batchForm} onSubmit={moveSelected}>
        <span>{selectedPrompts.length} selected across your library</span>
        <label className={styles.field}>
          <span>File selected in folder</span>
          <input aria-label="File selected in folder" value={batchFolder} onChange={event => setBatchFolder(event.target.value)} list="library-folders" maxLength={255} placeholder="Unfiled" disabled={batchBusy} />
        </label>
        <Button variant="secondary" type="submit" disabled={batchBusy}>{batchBusy ? 'Moving…' : 'Move selected'}</Button>
        <Button variant="danger" type="button" disabled={batchBusy} onClick={deleteSelected}>Delete selected</Button>
        <small>Leave the folder empty to move to Unfiled. Deleting can be undone for a few seconds.</small>
      </form>}
      {batchResult && <p className={styles.note} role="status">{batchResult}</p>}
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
