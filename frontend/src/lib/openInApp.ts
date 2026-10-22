/**
 * Hands prompt sections from a public page to the editor: the editor's Paste a
 * prompt review opens with them (`/editor/new?import=1`), behind the app's own
 * sign-in when needed. sessionStorage keeps them in this tab across sign-in; the
 * editor reads and removes them once.
 */

import type { ImportSession } from '@/features/editor/editorState';
import { pasteHandoffKey, splitLongSections } from './promptImport';
import { renderSections, valueFor, variablesIn } from './sections';
import type { PromptField } from '@/types/prompt';

export function openInApp({ title, fields: given, values = {}, hints = {} }: {
  title?: string;
  fields: PromptField[];
  values?: Record<string, string>;
  hints?: Record<string, string>;
}): void {
  // Sections are capped at 10,000 characters; split longer text losslessly as library import does.
  const { fields } = splitLongSections({ name: title ?? '', fields: given });
  const session: ImportSession = {
    text: renderSections(fields),
    title,
    conversion: { fields },
    variables: variablesIn(fields).map((name) => ({
      name, originalName: name, reuse: true, value: valueFor(values, name) ?? '', description: valueFor(hints, name) ?? '', source_text: null,
    })),
    keepExamples: false,
    reviewing: true,
  };
  try {
    sessionStorage.setItem(pasteHandoffKey(), JSON.stringify(session));
  } catch {
    // Storage blocked: the editor still opens Paste a prompt, empty.
  }
  // A full load, not router.push: the editor reads the handoff when it mounts, which a
  // client navigation to an already open /editor/new would not trigger again.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/editor/new?import=1');
}
