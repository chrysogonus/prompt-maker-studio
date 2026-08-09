/**
 * Product branding, in one place.
 *
 * The name used to be hardcoded in a dozen components, so a rename meant
 * hunting down every literal. Everything user-visible now derives from
 * `APP_NAME`, and every namespaced storage key from `APP_SLUG`.
 */

export const APP_NAME = 'Prompt Maker Studio';
export const APP_SLUG = 'prompt-maker-studio';

/** Slug used before the rename to "Prompt Maker Studio". See `migrateLegacyStorageKeys`. */
const LEGACY_APP_SLUG = 'prompt-maker';

/**
 * Build a `document.title`. `pageTitle()` returns the bare app name, which is
 * what the page-level `useEffect` cleanups restore on unmount.
 */
export function pageTitle(section?: string | null): string {
  return section ? `${section} · ${APP_NAME}` : APP_NAME;
}

/** Namespace a localStorage/sessionStorage key under the current app slug. */
export const storageKey = (suffix: string) => `${APP_SLUG}:${suffix}`;

/**
 * Key families that hold the user's own prompt text rather than a UI
 * preference. These are scoped by username at the call site so two accounts
 * sharing a browser can never restore each other's draft, and they are wiped
 * on explicit sign-out so the next person at the machine cannot read them.
 */
const USER_CONTENT_KEY_PREFIXES = ['draft:', 'editor-draft:', 'refine:'] as const;

/**
 * Delete every stored draft, on sign-out.
 *
 * Deliberately prefix-matched rather than keyed by the departing username: it
 * also clears drafts left by earlier sessions, including ones written before
 * these keys carried a username at all.
 */
export function clearUserContentKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (USER_CONTENT_KEY_PREFIXES.some((prefix) => key.startsWith(storageKey(prefix)))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage can throw in private mode; a failed purge must not block sign-out.
  }
}

/**
 * Move any storage entries written under the old `prompt-maker:` namespace to
 * the current one.
 *
 * Without this, the rename would silently sign every existing user out and
 * discard their unsaved drafts, since the app would look up keys that no
 * browser has. Runs once on client boot, before anything reads a token.
 *
 * Safe to delete once no active session predates the rename.
 */
export function migrateLegacyStorageKeys(): void {
  if (typeof window === 'undefined') return;

  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const legacyKeys: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key?.startsWith(`${LEGACY_APP_SLUG}:`)) legacyKeys.push(key);
      }

      for (const legacyKey of legacyKeys) {
        const renamed = `${APP_SLUG}:${legacyKey.slice(LEGACY_APP_SLUG.length + 1)}`;
        const value = store.getItem(legacyKey);
        // Never clobber a value already written under the new name — that one
        // is current, the legacy entry is a leftover.
        if (value !== null && store.getItem(renamed) === null) {
          store.setItem(renamed, value);
        }
        store.removeItem(legacyKey);
      }
    } catch {
      // Storage can throw in private mode or when the quota is exhausted.
      // A failed migration costs the user a re-login, not a broken app.
    }
  }
}
