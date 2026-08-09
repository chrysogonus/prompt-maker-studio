/**
 * The "new prompt" compose flow: field editor + AI import + generated
 * output. Once saved, the user is redirected to /editor/{id} which is
 * owned by EditorDetail (the mockup's full Editor/Detail screen) from then
 * on — this component only ever creates, never updates.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import InputPanel from './InputPanel';
import OutputPanel from './OutputPanel';
import PromptImporter from './PromptImporter';
import SavePromptDialog from './SavePromptDialog';
import PageHeader from './ui/PageHeader';
import { ApiClient } from '@/lib/api';
import { PromptField } from '@/types/prompt';
import styles from './EditorWorkspace.module.css';
import { storageKey } from '@/lib/branding';

const DRAFT_STORAGE_PREFIX = storageKey('draft');

interface EditorWorkspaceProps {
  currentUser: string | null;
}

interface PromptDraft {
  fields: PromptField[];
  generatedPrompt: string;
}

function createDefaultFields(): PromptField[] {
  return [{ name: 'goal', content: '' }];
}

/** The subset of a field that the generated output actually depends on. */
function generationKey(fields: PromptField[]): string {
  return JSON.stringify(fields.filter((f) => f.name && f.content));
}

export default function EditorWorkspace({ currentUser }: EditorWorkspaceProps) {
  const router = useRouter();
  const [fields, setFields] = useState<PromptField[]>(createDefaultFields);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dbId, setDbId] = useState<number | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  // Which field state the visible preview was generated from, so Save can tell
  // whether the preview still describes the fields the user is looking at.
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  // Save can now issue two requests (regenerate, then persist); guard it so a
  // repeated submit can't start a second one alongside the first.
  const isSavingRef = useRef(false);
  // An AI import replaces every field outright, so keep the state it overwrote
  // around until the user does something else with it.
  const [preImport, setPreImport] = useState<PromptDraft | null>(null);

  const draftStorageKey = currentUser ? `${DRAFT_STORAGE_PREFIX}:${currentUser}` : null;

  useEffect(() => {
    if (!draftStorageKey) return;
    const stored = localStorage.getItem(draftStorageKey);
    if (stored) {
      try {
        const draft = JSON.parse(stored) as Partial<PromptDraft>;
        let hasContent = false;
        if (Array.isArray(draft.fields) && draft.fields.length > 0) {
          const isDefault = draft.fields.length === 1 && draft.fields[0].name === 'goal' && !draft.fields[0].content;
          if (!isDefault) {
            setFields(draft.fields);
            hasContent = true;
          }
        }
        if (typeof draft.generatedPrompt === 'string' && draft.generatedPrompt.trim()) {
          setGeneratedPrompt(draft.generatedPrompt);
          hasContent = true;
        }
        if (hasContent) {
          setRestoredDraft(true);
        }
      } catch (err) {
        console.error('Failed to restore draft:', err);
        localStorage.removeItem(draftStorageKey);
      }
    }
    setHasLoadedDraft(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !hasLoadedDraft) return;
    const draft: PromptDraft = { fields, generatedPrompt };
    localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draftStorageKey, fields, generatedPrompt, hasLoadedDraft]);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError('');
    try {
      const validFields = fields.filter((f) => f.name && f.content);
      if (validFields.length === 0) {
        setError('Please fill in at least one field with both a name and content.');
        return;
      }
      const response = await ApiClient.generatePrompt({ fields: validFields });
      setGeneratedPrompt(response.generated_prompt);
      setGeneratedFrom(generationKey(validFields));
      setDbId(response.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate prompt. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportFields = (newFields: PromptField[]) => {
    setPreImport({ fields, generatedPrompt });
    setFields(newFields);
    setGeneratedPrompt('');
    setGeneratedFrom(null);
  };

  const handleUndoImport = () => {
    if (!preImport) return;
    setFields(preImport.fields);
    setGeneratedPrompt(preImport.generatedPrompt);
    setGeneratedFrom(null);
    setPreImport(null);
  };

  const handleSave = async (name: string) => {
    if (dbId === null || isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      const validFields = fields.filter((f) => f.name && f.content);
      // Editing a field after generating leaves the preview describing the old
      // field state. Saving that text persisted the pre-edit prompt and threw
      // the edit away silently, so regenerate first whenever the preview no
      // longer matches the fields — Save always means "save what I have now".
      let promptToSave = generatedPrompt;
      let targetId = dbId;
      if (generationKey(validFields) !== generatedFrom) {
        const regenerated = await ApiClient.generatePrompt({ fields: validFields });
        promptToSave = regenerated.generated_prompt;
        targetId = regenerated.id;
        setGeneratedPrompt(promptToSave);
        setGeneratedFrom(generationKey(validFields));
        setDbId(targetId);
      }

      const updated = await ApiClient.updatePrompt(targetId, {
        name,
        fields,
        generated_prompt: promptToSave,
      });
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      setShowSaveDialog(false);
      router.push(`/editor/${updated.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt.');
    } finally {
      isSavingRef.current = false;
    }
  };

  const isPreviewStale =
    !!generatedPrompt && generatedFrom !== null && generationKey(fields) !== generatedFrom;
  const canSave = !!generatedPrompt && dbId !== null;

  return (
    <div className={styles.workspace}>
      <PageHeader title="New prompt" />
      {error && <div className={styles.errorBanner}>{error}</div>}
      {restoredDraft && (
        <div className={styles.draftStatus} role="status">
          <span>Unsaved draft — restored from this device</span>
          <button
            type="button"
            onClick={() => {
              setFields(createDefaultFields());
              setGeneratedPrompt('');
              setRestoredDraft(false);
              if (draftStorageKey) {
                localStorage.removeItem(draftStorageKey);
              }
            }}
          >
            Discard
          </button>
        </div>
      )}
      <PromptImporter
        onImport={handleImportFields}
        existingFieldCount={fields.filter((f) => f.name && f.content).length}
        onUndo={preImport ? handleUndoImport : undefined}
      />
      <div className={styles.grid}>
        <div className={styles.leftPanel}>
          <InputPanel
            fields={fields}
            onFieldsChange={setFields}
            onGenerate={handleGenerate}
            isLoading={isLoading}
          />
        </div>
        <div className={styles.rightPanel}>
          {isPreviewStale && (
            <div className={styles.staleNotice} role="status">
              Fields changed since this was generated — Generate to refresh the preview. Saving
              regenerates it for you.
            </div>
          )}
          <OutputPanel
            prompt={generatedPrompt}
            onSave={() => setShowSaveDialog(true)}
            canSave={canSave}
            canUpdate={false}
          />
        </div>
      </div>

      <SavePromptDialog
        isOpen={showSaveDialog}
        currentName=""
        onSave={handleSave}
        onCancel={() => setShowSaveDialog(false)}
      />
    </div>
  );
}
