/**
 * The sidebar shows folder and favourite counts for the whole library. Pages
 * that change prompts announce it here so the counts refresh without a reload.
 */

export const LIBRARY_CHANGED_EVENT = 'pms:library-changed';

export function notifyLibraryChanged(): void {
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}
