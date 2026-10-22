import { normalizeSectionName } from '@/lib/sections';

import { PromptField, VariableMetadataItem, ParseTextResponse, ExtractedVariable } from '@/types/prompt';

export interface EditorSection {
  /** Stable React key; names can change and repeat while being typed. */
  key: number;
  name: string;
  content: string;
  hint?: string;
  /** Empty-section feedback waits until the section has been left once. */
  touched: boolean;
}

export type Metadata = Record<string, VariableMetadataItem>;

export interface Draft {
  /** Snapshot of the saved prompt the draft was based on; null for a new prompt. */
  base: string | null;
  sections: PromptField[];
  metadata: Metadata;
  note?: string;
  /** Converted inputs are browser-local unless explicitly kept as examples. */
  values?: Record<string, string>;
  importSession?: ImportSession;
}

export interface Notice {
  text: string;
  tone?: 'error';
  action?: { label: string; run: () => void };
}

const NEW_SECTION_HINT =
  'Write your prompt here. Put the parts that change each time in {{double_braces}}.';

let nextKey = 1;

export function toEditorSections(
  fields: { name: string; content: string; hint?: string }[],
  touched: boolean,
): EditorSection[] {
  return fields.map(({ name, content, hint }) => ({ key: nextKey++, name, content, hint, touched }));
}

export function blankSections(): EditorSection[] {
  return toEditorSections([{ name: 'Task', content: '', hint: NEW_SECTION_HINT }], false);
}

export function toFields(sections: EditorSection[]): PromptField[] {
  return sections.map(({ name, content }) => ({ name: normalizeSectionName(name), content }));
}

export function snapshot(fields: PromptField[], metadata: Metadata | null | undefined): string {
  const sorted = Object.keys(metadata ?? {})
    .sort()
    .map((key) => {
      const item = metadata![key];
      return [key, { type: item.type, ...(item.description ? { description: item.description } : {}),
        ...(item.required ? { required: true } : {}), ...(item.example ? { example: item.example } : {}) }];
    });
  return JSON.stringify({ fields, metadata: sorted });
}

export function readDraft(key: string | null): Draft | null {
  if (!key) return null;
  try {
    const draft = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
    if (draft?.base) {
      const base = JSON.parse(draft.base);
      draft.base = snapshot(base.fields, Object.fromEntries(base.metadata));
    }
    return draft;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function uniqueName(sections: EditorSection[]): string {
  let n = sections.length + 1;
  const taken = new Set(sections.map((s) => normalizeSectionName(s.name).toLowerCase()));
  while (taken.has(`section ${n}`)) n += 1;
  return `Section ${n}`;
}

export interface PromptEditorProps {
  /** Omitted for a new, not yet saved prompt. */
  promptId?: number;
  /** New prompts only: a starter template id to begin from, unless a draft exists. */
  initialStarter?: string;
  initialMode?: 'filled';
  /** New prompts only: open Paste a prompt straight away. */
  openImport?: boolean;
}

export interface ImportVariable extends ExtractedVariable {
  originalName: string;
  reuse: boolean;
}

export interface ImportSession {
  text: string;
  /** Title and folder chosen in the library's import preview, offered again on Save. */
  title?: string;
  folder?: string | null;
  conversion?: ParseTextResponse;
  variables?: ImportVariable[];
  keepExamples?: boolean;
  reviewing?: boolean;
}

export interface ImportedPrompt {
  saveAsWritten?: boolean;
  /** Offered as the name on Save when the import session has none. */
  title?: string;
  fields: PromptField[];
  metadata: Metadata;
  values: Record<string, string>;
}
