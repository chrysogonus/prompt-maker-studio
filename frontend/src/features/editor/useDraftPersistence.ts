'use client';

import { useEffect } from 'react';
import type { PromptField } from '@/types/prompt';
import type { Draft, Metadata } from './editorState';

interface DraftState {
  dirty: boolean;
  draftKey: string | null;
  fields: PromptField[];
  loadError: string;
  loading: boolean;
  metadata: Metadata;
  savedSnapshot: string | null;
}

/** Keep existing account-scoped drafts synchronized with the unsaved editor. */
export function useDraftPersistence({
  dirty, draftKey, fields, loadError, loading, metadata, savedSnapshot,
}: DraftState) {
  useEffect(() => {
    if (!draftKey || loading || loadError) return;
    if (!dirty) {
      localStorage.removeItem(draftKey);
      return;
    }
    const draft: Draft = { base: savedSnapshot, sections: fields, metadata };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [dirty, draftKey, fields, loadError, loading, metadata, savedSnapshot]);
}
