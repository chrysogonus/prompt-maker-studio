/**
 * The one editor for new and saved prompts. A prompt is an ordered list of
 * named sections; the server renders the text from them, and the preview pane
 * shows exactly that text, filled in or not, ready to copy.
 *
 * Saving is explicit (button or Ctrl/⌘+S). Unsaved edits are kept in
 * localStorage as a draft, so leaving the page never loses them.
 */

'use client';

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { ApiClient, ApiError, PROMPT_NOT_FOUND_MESSAGE, isValidPromptId } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pageTitle, storageKey } from '@/lib/branding';
import { normalizeSectionName, sectionNameError, variablesIn } from '@/lib/sections';
import { STARTER_TEMPLATES } from '@/lib/starterTemplates';
import {
  PromptField,
  PromptHistoryResponse,
  PromptUpdateRequest,
  PromptVersionResponse,
  VariableMetadataItem,
} from '@/types/prompt';
import HistoryPanel from './HistoryPanel';
import ImportDialog from './ImportDialog';
import PreviewPane from './PreviewPane';
import SectionCard from './SectionCard';
import VariablesPanel from './VariablesPanel';
import styles from './PromptEditor.module.css';

export interface EditorSection {
  /** Stable React key; names can change and repeat while being typed. */
  key: number;
  name: string;
  content: string;
  hint?: string;
  /** Empty-section feedback waits until the section has been left once. */
  touched: boolean;
}

type Metadata = Record<string, VariableMetadataItem>;

interface Draft {
  /** Snapshot of the saved prompt the draft was based on; null for a new prompt. */
  base: string | null;
  sections: PromptField[];
  metadata: Metadata;
}

interface Notice {
  text: string;
  tone?: 'error';
  action?: { label: string; run: () => void };
}

const NEW_SECTION_HINT =
  'Write your prompt here. Put the parts that change each time in {{double_braces}}.';

let nextKey = 1;

function toEditorSections(
  fields: { name: string; content: string; hint?: string }[],
  touched: boolean,
): EditorSection[] {
  return fields.map(({ name, content, hint }) => ({ key: nextKey++, name, content, hint, touched }));
}

function blankSections(): EditorSection[] {
  return toEditorSections([{ name: 'Task', content: '', hint: NEW_SECTION_HINT }], false);
}

function toFields(sections: EditorSection[]): PromptField[] {
  return sections.map(({ name, content }) => ({ name: normalizeSectionName(name), content }));
}

function snapshot(fields: PromptField[], metadata: Metadata | null | undefined): string {
  const sorted = Object.keys(metadata ?? {})
    .sort()
    .map((key) => [key, metadata![key]]);
  return JSON.stringify({ fields, metadata: sorted });
}

function readDraft(key: string | null): Draft | null {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function uniqueName(sections: EditorSection[]): string {
  let n = sections.length + 1;
  const taken = new Set(sections.map((s) => normalizeSectionName(s.name).toLowerCase()));
  while (taken.has(`section ${n}`)) n += 1;
  return `Section ${n}`;
}

interface PromptEditorProps {
  /** Omitted for a new, not yet saved prompt. */
  promptId?: number;
}

export default function PromptEditor({ promptId }: PromptEditorProps) {
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
  const [mode, setMode] = useState<'template' | 'filled'>('template');
  const [mobileTab, setMobileTab] = useState<'edit' | 'use'>(isNew ? 'edit' : 'use');
  const [previewOpen, setPreviewOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [saveDialog, setSaveDialog] = useState<{ name: string; folder: string; error: string } | null>(null);
  const [moveDialog, setMoveDialog] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const mutationChain = useRef<Promise<unknown>>(Promise.resolve());

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
        if (draft && draft.base === base) {
          setSections(toEditorSections(draft.sections, true));
          setMetadata(draft.metadata);
          setRestoredDraft(true);
        } else {
          setSections(toEditorSections(loaded.fields, true));
          setMetadata(loaded.variable_metadata ?? {});
        }
        if (variablesIn(loaded.fields).length > 0) setMode('filled');
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
  }, [applyPrompt, promptId]);

  // A new prompt picks up where the last unsaved one left off.
  useEffect(() => {
    if (!isNew) return;
    const draft = readDraft(draftKey);
    if (draft) {
      setSections(toEditorSections(draft.sections, true));
      setMetadata(draft.metadata);
      setRestoredDraft(true);
    }
  }, [draftKey, isNew]);

  // Keep the draft in step with every edit; drop it once nothing is unsaved.
  useEffect(() => {
    if (!draftKey || loading || loadError) return;
    if (!dirty) {
      localStorage.removeItem(draftKey);
      return;
    }
    const draft: Draft = { base: savedSnapshot, sections: fields, metadata };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [dirty, draftKey, fields, loadError, loading, metadata, savedSnapshot]);

  useEffect(() => {
    ApiClient.getPromptsConfig()
      .then((config) => setAiAvailable(config.provider_connected))
      .catch(() => setAiAvailable(true));
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
    if (savingRef.current) return;
    setSections((current) => current.map((s) => ({ ...s, touched: true })));
    if (nameErrors.some(Boolean)) {
      showNotice({ text: 'Fix the highlighted section names before saving.', tone: 'error' });
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
      setVersions(await ApiClient.getPromptVersions(updated.id));
      showNotice({ text: 'Saved' });
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
  };

  if (loading) {
    return <div className={styles.status}>Loading prompt…</div>;
  }

  if (loadError) {
    const notFound = loadError === PROMPT_NOT_FOUND_MESSAGE;
    return (
      <div className={styles.loadError} role="alert">
        <h1>{notFound ? 'Prompt not found' : 'Could not load prompt'}</h1>
        <p>{loadError}</p>
        <Button variant="secondary" onClick={() => router.push('/library')}>
          Back to library
        </Button>
      </div>
    );
  }

  const hasContent = fields.some((field) => field.content.trim());

  return (
    <div className={styles.editor} data-tab={mobileTab}>
      <header className={styles.head}>
        <div className={styles.crumbs}>
          {prompt && (
            <>
              <button
                type="button"
                className={styles.crumbFolder}
                onClick={() => setMoveDialog(prompt.folder ?? '')}
                title="Move to folder"
              >
                {prompt.folder || 'Unfiled'}
              </button>
              <span className={styles.crumbSep} aria-hidden="true">
                /
              </span>
            </>
          )}
          {prompt && renaming ? (
            <input
              className={styles.renameInput}
              defaultValue={prompt.name ?? ''}
              aria-label="Prompt name"
              maxLength={100}
              autoFocus
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : prompt ? (
            <button
              type="button"
              className={styles.title}
              onClick={() => setRenaming(true)}
              title="Rename"
            >
              {prompt.name}
            </button>
          ) : (
            <h1 className={styles.title}>New prompt</h1>
          )}
          {dirty && <span className={styles.edited}>Edited</span>}
        </div>
        <div className={styles.headActions}>
          {prompt && dirty && (
            <input
              className={styles.noteInput}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed? (optional)"
              aria-label="Version note"
              maxLength={255}
            />
          )}
          {prompt && dirty && (
            <Button variant="ghost" onClick={discardEdits}>
              Discard
            </Button>
          )}
          {prompt && (
            <Button
              variant="ghost"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-pressed={historyOpen}
            >
              History
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={saving || (!!prompt && !dirty)}>
            {saving ? 'Saving…' : prompt && !dirty ? 'Saved' : 'Save'}
          </Button>
        </div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'edit'}
          onClick={() => setMobileTab('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'use'}
          onClick={() => setMobileTab('use')}
        >
          Fill and copy
        </button>
      </div>

      {conflict && (
        <div className={`${styles.banner} ${styles.conflict}`} role="alert">
          <span>
            This prompt was changed somewhere else since you opened it. Your edits are still here.
          </span>
          <Button variant="secondary" onClick={reloadAfterConflict}>
            Load latest version
          </Button>
        </div>
      )}

      <div className={styles.body} data-preview={previewOpen ? 'open' : 'closed'}>
        <div className={styles.write}>
          {isNew && (
            <div className={styles.startRow}>
              <div className={styles.menuWrap}>
                <Button
                  variant="ghost"
                  onClick={() => setStarterOpen((open) => !open)}
                  aria-expanded={starterOpen}
                  aria-haspopup="menu"
                >
                  Starter templates
                </Button>
                {starterOpen && (
                  <div
                    className={styles.menu}
                    role="menu"
                    onKeyDown={(e) => e.key === 'Escape' && setStarterOpen(false)}
                  >
                    {hasContent && (
                      <p className={styles.menuNote}>Choosing a template replaces your sections.</p>
                    )}
                    {STARTER_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        role="menuitem"
                        className={styles.menuItem}
                        onClick={() => {
                          replaceSections(template.sections);
                          setStarterOpen(false);
                        }}
                      >
                        <strong>{template.label}</strong>
                        <span>{template.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                Import text
              </Button>
            </div>
          )}

          {restoredDraft && (
            <div className={styles.banner}>
              <span>Your unsaved changes were restored.</span>
              <button type="button" className={styles.link} onClick={discardEdits}>
                Discard changes
              </button>
            </div>
          )}

          <div className={styles.sections}>
            {sections.map((section, index) => (
              <SectionCard
                key={section.key}
                section={section}
                index={index}
                count={sections.length}
                nameError={nameErrors[index]}
                onChange={(change) => updateSection(section.key, change)}
                onMove={(offset) => moveSection(index, offset)}
                onRemove={() => removeSection(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.addSection}
            onClick={() =>
              setSections((current) => [
                ...current,
                ...toEditorSections([{ name: uniqueName(current), content: '' }], false),
              ])
            }
          >
            Add section
          </button>

          <VariablesPanel
            variables={variables}
            metadata={metadata}
            onDescribe={(name, description) =>
              setMetadata((current) => {
                // Clearing a hint returns to what was saved, so typing and
                // deleting one doesn't leave the prompt marked as edited.
                const saved = promptRef.current?.variable_metadata?.[name];
                const next = { ...current };
                if (description) {
                  next[name] = { type: current[name]?.type ?? saved?.type ?? 'text', description };
                } else if (saved) {
                  next[name] = { ...saved, description: null };
                } else {
                  delete next[name];
                }
                return next;
              })
            }
            onRemove={(name) =>
              setMetadata((current) => {
                const next = { ...current };
                delete next[name];
                return next;
              })
            }
          />
        </div>

        <PreviewPane
          fields={fields}
          variables={variables}
          metadata={metadata}
          values={values}
          onValueChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
          mode={mode}
          onModeChange={setMode}
          open={previewOpen}
          onToggle={() => setPreviewOpen((open) => !open)}
          onCopyFailed={() =>
            showNotice({ text: 'Copying failed. Select the text and copy it instead.', tone: 'error' })
          }
        />

        {historyOpen && prompt && (
          <HistoryPanel
            current={prompt}
            versions={versions}
            dirty={dirty}
            onClose={() => setHistoryOpen(false)}
            onRestore={restore}
          />
        )}
      </div>

      <Dialog
        isOpen={!!saveDialog}
        title="Save prompt"
        onClose={() => {
          if (!saving) setSaveDialog(null);
        }}
      >
        {saveDialog && (
          <form className={styles.dialogForm} onSubmit={createPrompt}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                value={saveDialog.name}
                onChange={(e) => setSaveDialog({ ...saveDialog, name: e.target.value, error: '' })}
                placeholder="For example: Weekly status update"
                maxLength={100}
                autoFocus
              />
            </label>
            <div className={styles.field}>
              <label htmlFor="save-folder">Folder</label>
              <input
                id="save-folder"
                value={saveDialog.folder}
                onChange={(e) => setSaveDialog({ ...saveDialog, folder: e.target.value })}
                list="editor-folders"
                placeholder="Unfiled"
                maxLength={255}
                aria-describedby="save-folder-hint"
              />
              <small id="save-folder-hint">Pick a folder or type a new name.</small>
            </div>
            {saveDialog.error && (
              <p className={styles.formError} role="alert">
                {saveDialog.error}
              </p>
            )}
            <div className={styles.dialogActions}>
              <Button variant="ghost" onClick={() => setSaveDialog(null)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save prompt'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog isOpen={moveDialog !== null} title="Move to folder" onClose={() => setMoveDialog(null)}>
        <form className={styles.dialogForm} onSubmit={move}>
          <div className={styles.field}>
            <label htmlFor="move-folder">Folder</label>
            <input
              id="move-folder"
              value={moveDialog ?? ''}
              onChange={(e) => setMoveDialog(e.target.value)}
              list="editor-folders"
              placeholder="Unfiled"
              maxLength={255}
              aria-describedby="move-folder-hint"
              autoFocus
            />
            <small id="move-folder-hint">
              Leave empty to keep it unfiled. Type a new name to create a folder.
            </small>
          </div>
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={() => setMoveDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Move
            </Button>
          </div>
        </form>
      </Dialog>

      <datalist id="editor-folders">
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>

      {/* A toast, so a status message never pushes the sections around. */}
      {notice && (
        <div className={styles.notice} role="status" data-tone={notice.tone}>
          {notice.text}
          {notice.action && (
            <button
              type="button"
              className={styles.noticeAction}
              onClick={() => {
                notice.action!.run();
                setNotice(null);
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}

      <ImportDialog
        isOpen={importOpen}
        aiAvailable={aiAvailable}
        replacesContent={hasContent}
        onClose={() => setImportOpen(false)}
        onImport={(imported) => {
          replaceSections(imported);
          setImportOpen(false);
          showNotice({
            text: `Imported ${imported.length} section${imported.length === 1 ? '' : 's'}. Review and rename them as needed.`,
          });
        }}
      />
    </div>
  );
}
