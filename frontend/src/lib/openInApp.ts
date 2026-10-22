/**
 * Hands prompt sections from a public page to the editor: `/editor/new?import=1`
 * opens them as an unsaved draft, behind the app's own sign-in when needed.
 * sessionStorage keeps them in this tab across sign-in; the editor reads and
 * removes them once.
 */

import type { ImportedPrompt } from '@/features/editor/editorState';
import { pasteHandoffKey, splitLongSections } from './promptImport';
import { valueFor, variablesIn } from './sections';
import type { PromptField } from '@/types/prompt';

/** Already structured, so it skips the Paste a prompt review. */
export interface AppHandoff extends ImportedPrompt {
  origin: 'handoff';
  title?: string;
  /** The public page it came from, offered as a way back from sign-in. */
  returnTo: string;
}

export function isAppHandoff(value: unknown): value is AppHandoff {
  return !!value && typeof value === 'object' && (value as AppHandoff).origin === 'handoff'
    && Array.isArray((value as AppHandoff).fields);
}

/** The hand-off waiting in this tab, if any, without consuming it. */
export function pendingHandoff(): AppHandoff | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(pasteHandoffKey()) ?? 'null');
    if (!isAppHandoff(parsed)) return null;
    // Only a path on this site is offered as the way back; URL parsing catches "/\\host" and the like.
    const back = new URL(String(parsed.returnTo ?? ''), window.location.origin);
    const local = back.origin === window.location.origin && String(parsed.returnTo ?? '').startsWith('/');
    return { ...parsed, returnTo: local ? back.pathname : '' };
  } catch {
    return null;
  }
}

export function openInApp({ title, fields: given, values = {}, hints = {} }: {
  title?: string;
  fields: PromptField[];
  values?: Record<string, string>;
  hints?: Record<string, string>;
}): void {
  // Sections are capped at 10,000 characters; split longer text losslessly as library import does.
  const { fields } = splitLongSections({ name: title ?? '', fields: given });
  const names = variablesIn(fields);
  const handoff: AppHandoff = {
    origin: 'handoff',
    title,
    returnTo: window.location.pathname,
    fields,
    values: Object.fromEntries(names.flatMap((name) => {
      const value = valueFor(values, name);
      return value ? [[name, value]] : [];
    })),
    metadata: Object.fromEntries(names.map((name) => [name, { type: 'text' as const, description: valueFor(hints, name) ?? '' }])),
  };
  try {
    sessionStorage.setItem(pasteHandoffKey(), JSON.stringify(handoff));
  } catch {
    // Storage blocked: the editor still opens Paste a prompt, empty.
  }
  // A full load, not router.push: the editor reads the handoff when it mounts, which a
  // client navigation to an already open /editor/new would not trigger again.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/editor/new?import=1');
}
