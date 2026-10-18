'use client';

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ApiClient, ApiError, PROMPT_NOT_FOUND_MESSAGE, isValidPromptId } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pageTitle, storageKey } from '@/lib/branding';
import { notifyLibraryChanged } from '@/lib/libraryEvents';
import { pasteHandoffKey } from '@/lib/promptImport';
import { sectionNameError, suggestTitle, variablesIn } from '@/lib/sections';
import { STARTER_TEMPLATES } from '@/lib/starterTemplates';
import { PromptField, PromptHistoryResponse, PromptUpdateRequest, PromptVersionResponse, PromptsConfigResponse } from '@/types/prompt';

import { useDraftPersistence } from './useDraftPersistence';
import {
  EditorSection,
  Draft,
  ImportedPrompt,
  ImportSession,
  Metadata,
  Notice,
  toEditorSections,
  blankSections,
  toFields,
  snapshot,
  readDraft,
  PromptEditorProps,
} from './editorState';

export function usePromptEditor({ promptId, initialStarter, initialMode, openImport }: PromptEditorProps) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const isNew = promptId === undefined;
  // Scoped by username: prompt ids are per account, and two accounts can
  // share a browser.
  const draftKey = currentUser ? storageKey(`editor-draft:${currentUser}:${promptId ?? 'new'}`) : null;

  const [prompt, setPrompt] = useState<PromptHistoryResponse | null>(null);
  const promptRef = useRef<PromptHistoryResponse | null>(null);
  const [versions, setVersions] = useState<PromptVersionResponse[]>([]);
  const [sections, setSections] = useState<EditorSection[]>(blankSections);
  const [metadata, setMetadata] = useState<Metadata>({});
  const [values, setValues] = useState<Record<string, string>>({});
  // Saved prompts keep filled inputs on this device; new ones only after a paste.
  const [rememberValues, setRememberValues] = useState(!isNew);
  const [importSession, setImportSession] = useState<ImportSession>({ text: '' });
  const [mode, setMode] = useState<'template' | 'filled'>(initialMode ?? 'template');
  const [mobileTab, setMobileTab] = useState<'edit' | 'use'>(isNew ? 'edit' : 'use');
  const [previewOpen, setPreviewOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [openFocused, setOpenFocused] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(false);
  const [draftAction, setDraftAction] = useState<Notice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [saveDialog, setSaveDialog] = useState<{ name: string; folder: string; error: string } | null>(null);
  const [moveDialog, setMoveDialog] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(Boolean(openImport));
  const [aiConfigLoading, setAiConfigLoading] = useState(true);
  const [aiConfigError, setAiConfigError] = useState(false);
  const [aiConfig, setAiConfig] = useState<PromptsConfigResponse | null>(null);
  const aiAvailable = Boolean(aiConfig?.provider_connected && !aiConfig.budget_exhausted);
  const mutationChain = useRef<Promise<unknown>>(Promise.resolve());
  const sectionsRef = useRef(sections);
  const metadataRef = useRef(metadata);
  const valuesRef = useRef(values);
  useLayoutEffect(() => { valuesRef.current = values; }, [values]);
  useLayoutEffect(() => { metadataRef.current = metadata; }, [metadata]);
  useLayoutEffect(() => { sectionsRef.current = sections; }, [sections]);

  const showNotice = useCallback((next: Notice, ms = 4000) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(next);
    noticeTimer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const applyPrompt = useCallback((next: PromptHistoryResponse) => {
    promptRef.current = next;
    setPrompt(next);
  }, []);

  const fields = useMemo(() => toFields(sections), [sections]);
  const variables = useMemo(() => variablesIn(fields), [fields]);
  const savedSnapshot = prompt ? snapshot(prompt.fields, prompt.variable_metadata) : null;
  const currentSnapshot = snapshot(fields, metadata);
  const dirty = prompt
    ? currentSnapshot !== savedSnapshot
    : fields.some((field) => field.content.trim()) || Object.keys(metadata).length > 0;

  const nameErrors = sections.map((section, i) =>
    sectionNameError(
      section.name,
      sections.filter((_, j) => j !== i).map((other) => other.name),
    ),
  );

  const restoreInputs = useCallback((draft: Draft) => {
    setValues(draft.values ?? {});
    setRememberValues((remember) => remember || draft.values !== undefined);
    setImportSession(draft.importSession ?? { text: '' });
    if (draft.importSession?.text) setImportOpen(true);
    if (draft.values !== undefined) {
      setMode('filled');
      setMobileTab('use');
      setPreviewOpen(true);
    }
  }, []);

  // Load a saved prompt, preferring a draft made against the same saved state.
  useEffect(() => {
    if (promptId === undefined) return;
    let cancelled = false;
    (async () => {
      if (!isValidPromptId(promptId)) {
        setLoadError(PROMPT_NOT_FOUND_MESSAGE);
        setLoading(false);
        return;
      }
      try {
        const [loaded, history] = await Promise.all([
          ApiClient.getPromptById(promptId),
          ApiClient.getPromptVersions(promptId),
        ]);
        if (cancelled) return;
        applyPrompt(loaded);
        setVersions(history);
        const base = snapshot(loaded.fields, loaded.variable_metadata);
        const draft = readDraft(draftKey);
        const current = draft?.base === base ? draft : null;
        const restored = !!current && (snapshot(current.sections, current.metadata) !== base || !!current.importSession?.text);
        if (current) {
          setSections(toEditorSections(current.sections, true));
          setMetadata(current.metadata);
          setNote(current.note ?? '');
          restoreInputs(current);
          setRestoredDraft(restored);
        } else {
          setSections(toEditorSections(loaded.fields, true));
          setMetadata(loaded.variable_metadata ?? {});
        }
        if (variablesIn(current ? current.sections : loaded.fields).length > 0) {
          setMode('filled');
          // Unsaved template edits stay in view; otherwise open ready to fill.
          setOpenFocused(!restored);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load prompt.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `draftKey` only changes when the signed-in user does, which remounts anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyPrompt, promptId, restoreInputs]);

  // A new prompt picks up where the last unsaved one left off, and otherwise
  // starts from the template it was opened with.
  useEffect(() => {
    if (!isNew) return;
    const draft = readDraft(draftKey);
    const starter = STARTER_TEMPLATES.find((template) => template.id === initialStarter);
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only draft hydration must run after mount.
      setSections(toEditorSections(draft.sections, true));
      setMetadata(draft.metadata);
      setNote(draft.note ?? '');
      restoreInputs(draft);
      setRestoredDraft(true);
    } else if (starter) {
      setSections(toEditorSections(starter.sections, false));
    }
    // A note sent from the library's Add existing prompts preview, read once.
    if (openImport) {
      let handoff: string | null = null;
      try { handoff = sessionStorage.getItem(pasteHandoffKey()); sessionStorage.removeItem(pasteHandoffKey()); } catch { /* Storage unavailable. */ }
      if (handoff) setImportSession({ text: handoff });
    }
  }, [draftKey, initialStarter, isNew, openImport, restoreInputs]);

  useDraftPersistence({ dirty, draftKey, fields, loadError, loading, metadata, note, savedSnapshot, values, rememberValues, importSession, importOpen });

  useEffect(() => {
    ApiClient.getPromptsConfig()
      .then(setAiConfig)
      .catch(() => setAiConfigError(true))
      .finally(() => setAiConfigLoading(false));
    ApiClient.getFolders()
      .then(setFolders)
      .catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    if (loading) return;
    document.title = pageTitle(
      isNew ? 'New prompt' : (prompt?.name ?? (loadError ? 'Could not load prompt' : 'Prompt')),
    );
    return () => {
      document.title = pageTitle();
    };
  }, [isNew, loadError, loading, prompt?.name]);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = mutationChain.current.then(task, task);
    mutationChain.current = result.catch(() => undefined);
    return result;
  }, []);

  /** PATCH stamped with the freshest known server state, one at a time. */
  const patch = useCallback(
    (body: PromptUpdateRequest) =>
      enqueue(async () => {
        const current = promptRef.current!;
        const updated = await ApiClient.updatePrompt(current.id, {
          ...body,
          last_updated_at: current.updated_at || current.created_at,
        });
        applyPrompt(updated);
        return updated;
      }),
    [applyPrompt, enqueue],
  );

  const reportError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 409) {
      setConflict(true);
      return;
    }
    showNotice({ text: err instanceof Error ? err.message : fallback, tone: 'error' }, 8000);
  };

  const save = async () => {
    if (savingRef.current || refineOpen) return;
    setSections((current) => current.map((s) => ({ ...s, touched: true })));
    if (nameErrors.some(Boolean)) {
      showNotice({ text: 'Fix the highlighted section names before saving.', tone: 'error' });
      return;
    }
    if (fields.some((field) => Array.from(field.content).length > 10000)) {
      showNotice({ text: 'Shorten the highlighted section text before saving.', tone: 'error' });
      return;
    }
    if (!prompt) {
      setSaveDialog({ name: '', folder: '', error: '' });
      return;
    }
    if (!dirty) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await patch({
        fields,
        variable_metadata: metadata,
        note: note.trim() || null,
      });
      setSections((current) =>
        current.map((s, i) => ({ ...s, name: updated.fields[i]?.name ?? s.name })),
      );
      setNote('');
      setRestoredDraft(false);
      setConflict(false);
      setDraftAction(null);
      try {
        setVersions(await ApiClient.getPromptVersions(updated.id));
        showNotice({ text: 'Saved' });
      } catch {
        showNotice({ text: 'Saved. Version history is unavailable; reload to retry.' }, 8000);
      }
    } catch (err) {
      reportError(err, 'Failed to save prompt.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Ctrl/⌘+S saves here instead of the browser's "Save page".
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saveDialog) saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveDialog]);

  const createPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!saveDialog || savingRef.current) return;
    if (fields.some((field) => Array.from(field.content).length > 10000)) {
      setSaveDialog({ ...saveDialog, error: 'Section text must be 10,000 characters or fewer.' });
      return;
    }
    const name = saveDialog.name.trim();
    if (!name) {
      setSaveDialog({ ...saveDialog, error: 'Give the prompt a name.' });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const created = await ApiClient.createPrompt({
        name,
        fields,
        folder: saveDialog.folder.trim() || null,
        variable_metadata: metadata,
      });
      if (currentUser && rememberValues) {
        const savedDraft: Draft = {
          base: snapshot(created.fields, created.variable_metadata), sections: created.fields,
          metadata: created.variable_metadata ?? {}, values, note: '',
        };
        localStorage.setItem(storageKey(`editor-draft:${currentUser}:${created.id}`), JSON.stringify(savedDraft));
      }
      if (draftKey) localStorage.removeItem(draftKey);
      router.replace(`/editor/${created.id}`);
    } catch (err) {
      setSaveDialog({
        ...saveDialog,
        error: err instanceof Error ? err.message : 'Failed to save prompt.',
      });
      savingRef.current = false;
      setSaving(false);
    }
  };

  const discardEdits = () => {
    if (draftKey) localStorage.removeItem(draftKey);
    setNote('');
    setImportSession({ text: '' });
    const retained = new Set(variablesIn(prompt?.fields ?? []));
    setValues((current) => Object.fromEntries(Object.entries(current).filter(([name]) => retained.has(name))));
    setNotice(null);
    setDraftAction(null);
    setRestoredDraft(false);
    setConflict(false);
    if (prompt) {
      setSections(toEditorSections(prompt.fields, true));
      setMetadata(prompt.variable_metadata ?? {});
    } else {
      setSections(blankSections());
      setMetadata({});
    }
  };

  const reloadAfterConflict = async () => {
    try {
      applyPrompt(await ApiClient.getPromptById(prompt!.id));
      setVersions(await ApiClient.getPromptVersions(prompt!.id));
      setConflict(false);
      showNotice({
        text: 'Loaded the latest saved version. Your edits are still here; saving replaces it.',
      });
    } catch (err) {
      reportError(err, 'Failed to reload prompt.');
    }
  };

  const restore = async (versionId: number, versionNumber: number) => {
    try {
      const restored = await enqueue(async () => {
        const updated = await ApiClient.restorePromptVersion(promptRef.current!.id, versionId);
        applyPrompt(updated);
        return updated;
      });
      setSections(toEditorSections(restored.fields, true));
      setMetadata(restored.variable_metadata ?? {});
      setVersions(await ApiClient.getPromptVersions(restored.id));
      showNotice({ text: `Restored version ${versionNumber}` });
    } catch (err) {
      reportError(err, 'Failed to restore that version.');
    }
  };

  const rename = async (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (!prompt || !name || name === prompt.name) return;
    try {
      await patch({ name });
      notifyLibraryChanged();
    } catch (err) {
      reportError(err, 'Failed to rename prompt.');
    }
  };

  const move = async (event: FormEvent) => {
    event.preventDefault();
    const folder = (moveDialog ?? '').trim();
    setMoveDialog(null);
    try {
      await patch({ folder });
      notifyLibraryChanged();
      showNotice({ text: folder ? `Moved to ${folder}` : 'Moved to Unfiled' });
    } catch (err) {
      reportError(err, 'Failed to move prompt.');
    }
  };

  const updateSection = (key: number, change: Partial<EditorSection>) =>
    setSections((current) => current.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const moveSection = (index: number, offset: -1 | 1) =>
    setSections((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });

  const removeSection = (index: number) => {
    const removed = sections[index];
    setSections((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length ? next : blankSections();
    });
    showNotice(
      {
        text: `Removed “${removed.name || 'section'}”`,
        action: {
          label: 'Undo',
          run: () =>
            setSections((current) => [
              ...current.slice(0, index),
              removed,
              ...current.slice(index),
            ]),
        },
      },
      6000,
    );
  };

  const replaceSections = (next: { name: string; content: string; hint?: string }[]) => {
    setSections(toEditorSections(next, false));
    setMetadata({});
    setValues({});
    setRememberValues(false);
  };

  const applyRefinement = (next: PromptField[]) => {
    const before = sections;
    setSections((current) => current.map((section, i) => ({
      ...section, content: next[i].content, touched: true,
    })));
    setRefineOpen(false);
    setDraftAction({
      text: 'Applied to draft—save to keep',
      action: { label: 'Undo', run: () => {
        if (JSON.stringify(toFields(sectionsRef.current)) !== JSON.stringify(next)) {
          showNotice({ text: 'Your prompt changed. Undo is no longer available.', tone: 'error' });
          return;
        }
        setSections(before);
      } },
    });
  };

  const importSections = (next: ImportedPrompt) => {
    const before = { sections, metadata, values, rememberValues, mode, mobileTab, previewOpen, importSession };
    setSections(toEditorSections(next.fields, false));
    setMetadata(next.metadata);
    setValues(next.values);
    setRememberValues(true);
    setMode('filled');
    setMobileTab('use');
    setPreviewOpen(true);
    setImportSession({ text: '' });
    setImportOpen(false);
    if (next.saveAsWritten && isNew) {
      setSaveDialog({ name: suggestTitle(next.fields[0].content), folder: '', error: '' });
    }
    if (isNew && openImport) {
      const params = new URLSearchParams(window.location.search);
      params.delete('import');
      router.replace(`/editor/new${params.size ? `?${params}` : ''}`, { scroll: false });
    }
    setDraftAction({
      text: `Imported ${next.fields.length} section${next.fields.length === 1 ? '' : 's'} into draft—save to keep.`,
      action: { label: 'Undo', run: () => {
        if (snapshot(toFields(sectionsRef.current), metadataRef.current) !== snapshot(next.fields, next.metadata)
          || JSON.stringify(valuesRef.current) !== JSON.stringify(next.values)) {
          showNotice({ text: 'Your prompt changed. Undo is no longer available.', tone: 'error' });
          return;
        }
        setSections(before.sections);
        setMetadata(before.metadata);
        setValues(before.values);
        setRememberValues(before.rememberValues);
        setMode(before.mode);
        setMobileTab(before.mobileTab);
        setPreviewOpen(before.previewOpen);
        setImportSession(before.importSession);
      } },
    });
  };
  return {
    router,
    isNew,
    prompt,
    promptRef,
    versions,
    sections,
    setSections,
    metadata,
    setMetadata,
    values,
    setValues,
    mode,
    setMode,
    mobileTab,
    setMobileTab,
    previewOpen,
    setPreviewOpen,
    historyOpen,
    setHistoryOpen,
    refineOpen,
    setRefineOpen,
    restoredDraft,
    openFocused,
    rememberValues,
    loading,
    loadError,
    saving,
    note,
    setNote,
    conflict,
    notice,
    setNotice,
    draftAction,
    setDraftAction,
    saveDialog,
    setSaveDialog,
    moveDialog,
    setMoveDialog,
    folders,
    renaming,
    setRenaming,
    starterOpen,
    setStarterOpen,
    importOpen,
    setImportOpen,
    importSession,
    setImportSession,
    aiAvailable,
    aiConfig,
    aiConfigLoading,
    aiConfigError,
    importSections,
    showNotice,
    fields,
    variables,
    dirty,
    nameErrors,
    save,
    createPrompt,
    discardEdits,
    reloadAfterConflict,
    restore,
    rename,
    move,
    updateSection,
    moveSection,
    removeSection,
    replaceSections,
    applyRefinement,
  };
}
