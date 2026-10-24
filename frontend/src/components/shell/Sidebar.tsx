'use client';

import Link from 'next/link';
import { ArrowUpRight, BookOpen, CodeXml, LayoutTemplate, Wrench } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { PromptMakerTile } from '@/components/brand/PromptMakerMark';
import { REPOSITORY_URL } from '@/components/RepositoryLink';
import {
  AllPromptsIcon,
  FavoriteIcon,
  FolderIcon,
  NewIcon,
  SettingsIcon,
  UnfiledIcon,
} from '@/components/ui/icon';
import { useLibraryData } from '@/features/library/LibraryData';
import { useAuth } from '@/lib/auth-context';
import { APP_NAME } from '@/lib/branding';
import {
  RECOVERED_HISTORY_FOLDER,
  libraryHref,
  viewFromParams,
  type LibraryView,
} from '@/lib/libraryViews';
import styles from './Sidebar.module.css';
import ThemeControl from './ThemeControl';

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

const MOBILE_QUERY = '(max-width: 760px)';
function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

export default function Sidebar({ open, onNavigate }: SidebarProps) {
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const sidebarRef = useRef<HTMLElement>(null);
  const onNavigateRef = useRef(onNavigate);
  useLayoutEffect(() => { onNavigateRef.current = onNavigate; });
  useLayoutEffect(() => {
    // React 18 does not forward the native boolean `inert` attribute.
    sidebarRef.current?.toggleAttribute('inert', mobile && !open);
  }, [mobile, open]);
  useEffect(() => {
    if (!mobile || !open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current!;
    const focusable = () => sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled)');
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onNavigateRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!sidebar.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [mobile, open]);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentUser, logout } = useAuth();
  const { prompts: library, load } = useLibraryData();

  useEffect(() => { void load().catch(() => {}); }, [load, pathname]);

  const counts = useMemo(() => {
    const prompts = library ?? [];
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
  }, [library]);

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
      <span className={styles.label} title={label}>{label}</span>
      {count ? <span className={styles.count}>{count}</span> : null}
    </Link>
  );

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      data-open={open}
      aria-label="Sidebar"
      aria-hidden={mobile && !open ? true : undefined}
      role={mobile && open ? 'dialog' : undefined}
      aria-modal={mobile && open ? true : undefined}
    >
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
        {item({ type: 'favorites' }, 'Favourites', <FavoriteIcon tone="inherit" />, counts.favorites)}

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
        <ThemeControl />
        {/* These are the public pages, with their own layout; the arrow says they leave the app. */}
        <p id="sidebar-public-note" hidden>Opens the public pages, outside the app.</p>
        <Link href="/guides" className={styles.item} onClick={onNavigate} aria-describedby="sidebar-public-note">
          <BookOpen size={16} aria-hidden="true" />
          <span className={styles.label}>Guides</span>
          <ArrowUpRight size={14} className={styles.leaves} aria-hidden="true" />
        </Link>
        <Link href="/tools" className={styles.item} onClick={onNavigate} aria-describedby="sidebar-public-note">
          <Wrench size={16} aria-hidden="true" />
          <span className={styles.label}>Free tools</span>
          <ArrowUpRight size={14} className={styles.leaves} aria-hidden="true" />
        </Link>
        <Link href="/gallery" className={styles.item} onClick={onNavigate} aria-describedby="sidebar-public-note">
          <LayoutTemplate size={16} aria-hidden="true" />
          <span className={styles.label}>Template gallery</span>
          <ArrowUpRight size={14} className={styles.leaves} aria-hidden="true" />
        </Link>
        <Link
          href="/settings"
          className={styles.item}
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
          onClick={onNavigate}
        >
          <SettingsIcon tone="inherit" />
          <span className={styles.label}>Settings</span>
        </Link>
        <a href={REPOSITORY_URL} className={styles.sourceLink}>
          <CodeXml size={16} strokeWidth={1.75} aria-hidden="true" />
          Open source on GitHub
        </a>
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
