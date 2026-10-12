'use client';

import { useEffect } from 'react';
import type { PromptField } from '@/types/prompt';
import type { Draft, ImportSession, Metadata } from './editorState';

interface DraftState {
  dirty: boolean;
  draftKey: string | null;
  fields: PromptField[];
  loadError: string;
  loading: boolean;
  metadata: Metadata;
  note: string;
  savedSnapshot: string | null;
  values: Record<string, string>;
  rememberValues: boolean;
  importSession: ImportSession;
}

/** Keep existing account-scoped drafts synchronized with the unsaved editor. */
export function useDraftPersistence({
  dirty, draftKey, fields, loadError, loading, metadata, note, savedSnapshot, values, rememberValues, importSession,
}: DraftState) {
  useEffect(() => {
    if (!draftKey || loading || loadError) return;
    const pendingImport = !!importSession.text;
    if (!dirty && !(rememberValues && Object.keys(values).length) && !pendingImport) {
      localStorage.removeItem(draftKey);
      return;
    }
    const draft: Draft = { base: savedSnapshot, sections: fields, metadata, note,
      ...(rememberValues ? { values } : {}),
      ...(pendingImport ? { importSession } : {}),
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [dirty, draftKey, fields, loadError, loading, metadata, note, savedSnapshot, values, rememberValues, importSession]);
}
