'use client';

import { Suspense } from 'react';
import Link from 'next/link';

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

import { RECOVERED_HISTORY_FOLDER } from '@/lib/libraryViews';
import { relativeTime } from '@/lib/relativeTime';
import { variablesIn } from '@/lib/sections';
import { STARTER_TEMPLATES } from '@/lib/starterTemplates';

import styles from './LibraryPage.module.css';
import type { Toast } from './libraryState';
import { useLibrary } from './useLibrary';
import { Prompt, excerpt, editedAt } from './libraryState';

function LibraryContent() {
  const {
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
  } = useLibrary();

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
        <Button variant="secondary" onClick={() => void load()}>
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
          <div className={styles.heroActions}>
            <Link href="/editor/new" className={styles.primaryLink}>
              New prompt
            </Link>
            <Link href="/editor/new?import=1" className={styles.secondaryLink}>
              Paste a prompt
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
        <Link href="/editor/new?import=1" className={styles.secondaryLink}>Paste a prompt</Link>
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
