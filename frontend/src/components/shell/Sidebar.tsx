'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PromptMakerTile } from '@/components/brand/PromptMakerMark';
import {
  AllPromptsIcon,
  FavoriteIcon,
  FolderIcon,
  NewIcon,
  SettingsIcon,
  UnfiledIcon,
} from '@/components/ui/icon';
import { ApiClient } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { APP_NAME } from '@/lib/branding';
import { LIBRARY_CHANGED_EVENT } from '@/lib/libraryEvents';
import {
  RECOVERED_HISTORY_FOLDER,
  libraryHref,
  viewFromParams,
  type LibraryView,
} from '@/lib/libraryViews';
import type { PromptHistoryResponse } from '@/types/prompt';
import styles from './Sidebar.module.css';

interface SidebarProps {
  /** Phone only: whether the drawer is showing. */
  open: boolean;
  onNavigate: () => void;
}

function sortFolders(folders: string[]): string[] {
  // Recovered history is a holding area, so it sits below the user's own folders.
  return [...folders].sort((a, b) =>
    a === RECOVERED_HISTORY_FOLDER ? 1 : b === RECOVERED_HISTORY_FOLDER ? -1 : a.localeCompare(b),
  );
}

export default function Sidebar({ open, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentUser, logout } = useAuth();
  const [prompts, setPrompts] = useState<PromptHistoryResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      ApiClient.getSavedPrompts()
        .then((data) => !cancelled && setPrompts(data))
        .catch(() => {});
    load();
    window.addEventListener(LIBRARY_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_CHANGED_EVENT, load);
    };
  }, [pathname]);

  const counts = useMemo(() => {
    const folders = new Map<string, number>();
    let unfiled = 0;
    for (const p of prompts) {
      if (p.folder) folders.set(p.folder, (folders.get(p.folder) ?? 0) + 1);
      else unfiled += 1;
    }
    return {
      all: prompts.length,
      favorites: prompts.filter((p) => p.is_favorite).length,
      unfiled,
      folders: sortFolders([...folders.keys()]).map((name) => ({ name, count: folders.get(name)! })),
    };
  }, [prompts]);

  const current = pathname === '/library' ? viewFromParams(searchParams) : null;

  const isCurrent = (view: LibraryView) =>
    current !== null &&
    current.type === view.type &&
    (view.type !== 'folder' || (current.type === 'folder' && current.folder === view.folder));

  const item = (view: LibraryView, label: string, icon: React.ReactNode, count?: number) => (
    <Link
      key={view.type === 'folder' ? `folder:${view.folder}` : view.type}
      href={libraryHref(view)}
      className={styles.item}
      aria-current={isCurrent(view) ? 'page' : undefined}
      onClick={onNavigate}
    >
      {icon}
      <span className={styles.label}>{label}</span>
      {count ? <span className={styles.count}>{count}</span> : null}
    </Link>
  );

  return (
    <aside className={styles.sidebar} data-open={open} aria-label="Sidebar">
      <Link href="/library" className={styles.brand} onClick={onNavigate}>
        <PromptMakerTile size={28} />
        <span>{APP_NAME}</span>
      </Link>

      <Link href="/editor/new" className={styles.newPrompt} onClick={onNavigate}>
        <NewIcon size={16} tone="inherit" />
        New prompt
      </Link>

      <nav aria-label="Library" className={styles.nav}>
        {item({ type: 'all' }, 'All prompts', <AllPromptsIcon tone="inherit" />, counts.all)}
        {item({ type: 'favorites' }, 'Favorites', <FavoriteIcon tone="inherit" />, counts.favorites)}

        <h2 className={styles.heading}>Folders</h2>
        {counts.folders.map(({ name, count }) =>
          item({ type: 'folder', folder: name }, name, <FolderIcon tone="inherit" />, count),
        )}
        {counts.unfiled > 0 &&
          item({ type: 'unfiled' }, 'Unfiled', <UnfiledIcon tone="inherit" />, counts.unfiled)}
        {counts.folders.length === 0 && (
          <p className={styles.empty}>Folders appear when you file a prompt.</p>
        )}
      </nav>

      <div className={styles.foot}>
        <Link
          href="/settings"
          className={styles.item}
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
          onClick={onNavigate}
        >
          <SettingsIcon tone="inherit" />
          <span className={styles.label}>Settings</span>
        </Link>
        <div className={styles.account}>
          <span className={styles.user}>Signed in as {currentUser}</span>
          <button type="button" className={styles.signOut} onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
