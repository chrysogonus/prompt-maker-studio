/** The ways the library can be narrowed, and the URL for each. */

export const RECOVERED_HISTORY_FOLDER = 'Recovered history';

export type LibraryView =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'unfiled' }
  | { type: 'folder'; folder: string };

export function libraryHref(view: LibraryView): string {
  switch (view.type) {
    case 'all':
      return '/library';
    case 'favorites':
      return '/library?view=favorites';
    case 'unfiled':
      return '/library?view=unfiled';
    case 'folder':
      return `/library?${new URLSearchParams({ folder: view.folder })}`;
  }
}

export function viewFromParams(params: { get(name: string): string | null }): LibraryView {
  const folder = params.get('folder');
  if (folder) return { type: 'folder', folder };
  const view = params.get('view');
  if (view === 'favorites' || view === 'unfiled') return { type: view };
  return { type: 'all' };
}

export function viewTitle(view: LibraryView): string {
  switch (view.type) {
    case 'all':
      return 'All prompts';
    case 'favorites':
      return 'Favorites';
    case 'unfiled':
      return 'Unfiled';
    case 'folder':
      return view.folder;
  }
}
