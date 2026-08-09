/**
 * The mockup's full Editor/Detail screen for an already-saved (or
 * unnamed-history) prompt: a breadcrumb/header shell (name, meta,
 * "Test in playground"/Update actions) plus three tabs — Configuration
 * (template editor, version history, variables, tags, usage), Evaluate,
 * and Refine. `templateText` is owned here (not per-tab) because the
 * header's Update action operates on it regardless of which tab is active.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Button from './ui/Button';
import SavePromptDialog from './SavePromptDialog';
import ConfigurationTab from './editor/ConfigurationTab';
import EvaluateTab from './editor/EvaluateTab';
import RefineTab from './editor/RefineTab';
import {
  ErrorStatusIcon,
  InfoStatusIcon,
  LoadingIcon,
  RefineIcon,
  SuccessStatusIcon,
} from './ui/icon';
import { ApiClient, ApiError, PROMPT_NOT_FOUND_MESSAGE, isValidPromptId } from '@/lib/api';
import { AuthService } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { PromptHistoryResponse, PromptUpdateRequest, PromptVersionResponse } from '@/types/prompt';
import { User } from '@/types/auth';
import styles from './EditorDetail.module.css';
import { pageTitle, storageKey } from '@/lib/branding';

interface EditorDetailProps {
  promptId: number;
}

type DetailTab = 'configuration' | 'evaluate' | 'refine';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

export default function EditorDetail({ promptId }: EditorDetailProps) {
  const [prompt, setPrompt] = useState<PromptHistoryResponse | null>(null);
  const [templateText, setTemplateText] = useState('');
  const [versions, setVersions] = useState<PromptVersionResponse[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [connectedModel, setConnectedModel] = useState<string | null>(null);
  const { currentUser: signedInAs } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const initialTab = (searchParams.get('tab') as DetailTab) || 'configuration';
  const [activeTab, setActiveTabState] = useState<DetailTab>(initialTab);

  const setActiveTab = (tab: DetailTab) => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const currentTab = (searchParams.get('tab') as DetailTab) || 'configuration';
    setActiveTabState(currentTab);
  }, [searchParams]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [evalRunStatus, setEvalRunStatus] = useState<'' | 'running' | 'complete' | 'failed'>('');
  const [showEvalCta, setShowEvalCta] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [conflict, setConflict] = useState('');
  const saveNoticeTimerRef = useRef<number | null>(null);
  // Scoped by username as well as prompt id: prompt ids are per-account, so two
  // accounts sharing a browser would otherwise restore each other's draft.
  const draftStorageKey = signedInAs ? storageKey(`editor-draft:${signedInAs}:${promptId}`) : null;

  // The server's optimistic-concurrency check compares the prompt's stored
  // `updated_at` against the `last_updated_at` the client sends, so every
  // mutation has to be built from — and stamped with — the newest server state.
  // Reading that out of React state let two edits fired inside one render
  // window share one stale token (the second was rejected with a spurious 409)
  // and share one stale copy of `tags`/`variable_metadata` (the second silently
  // dropped the first's change). A ref holds the authoritative copy, and a
  // promise chain keeps mutations strictly sequential so each one sees the
  // previous one's response.
  const promptRef = useRef<PromptHistoryResponse | null>(null);
  const mutationChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const applyPrompt = useCallback((next: PromptHistoryResponse) => {
    promptRef.current = next;
    setPrompt(next);
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = mutationChainRef.current.then(task, task);
    // Swallow rejections on the chain itself so one failure doesn't poison
    // every later mutation; callers still see their own rejection.
    mutationChainRef.current = result.catch(() => undefined);
    return result;
  }, []);

  /**
   * Serialize a PATCH against the prompt. `buildPatch` receives the freshest
   * known server state and returns the patch to send, or null to skip.
   */
  const patchPrompt = useCallback(
    (buildPatch: (current: PromptHistoryResponse) => PromptUpdateRequest | null) =>
      enqueue(async () => {
        const current = promptRef.current;
        if (!current) return null;
        const patch = buildPatch(current);
        if (!patch) return null;
        const updated = await ApiClient.updatePrompt(promptId, {
          ...patch,
          last_updated_at: current.updated_at || current.created_at || undefined,
        });
        applyPrompt(updated);
        return updated;
      }),
    [applyPrompt, enqueue, promptId],
  );

  const reportMutationError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 409) {
      setConflict(err.message);
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
  };

  const showSaveNotice = (message: string) => {
    if (saveNoticeTimerRef.current) window.clearTimeout(saveNoticeTimerRef.current);
    // A newer notice supersedes the "run your eval set" nudge left by an earlier
    // update, rather than stacking a second banner above a stale one. Callers
    // that still want the nudge re-raise it after this via `maybeAutoRunEval`.
    setShowEvalCta(false);
    setSaveNotice(message);
    saveNoticeTimerRef.current = window.setTimeout(() => setSaveNotice(''), 4000);
  };

  useEffect(() => {
    return () => {
      if (saveNoticeTimerRef.current) window.clearTimeout(saveNoticeTimerRef.current);
    };
  }, []);

  const isDirty = prompt ? templateText !== prompt.generated_prompt : false;

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const link = target?.closest('a');
      if (link && link.getAttribute('href') && !link.getAttribute('href')?.startsWith('#')) {
        const confirmed = window.confirm(
          'You have unsaved changes. Are you sure you want to leave? Your changes will be saved locally as a draft.'
        );
        if (!confirmed) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleLinkClick, true);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleLinkClick, true);
    };
  }, [isDirty]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setConflict('');
    if (!isValidPromptId(promptId)) {
      setError(PROMPT_NOT_FOUND_MESSAGE);
      setIsLoading(false);
      return;
    }
    try {
      const p = await ApiClient.getPromptById(promptId);
      const v = await ApiClient.getPromptVersions(promptId);
      applyPrompt(p);
      let initialTemplate = p.generated_prompt;
      try {
        const saved = draftStorageKey
          ? (JSON.parse(localStorage.getItem(draftStorageKey) ?? 'null') as {
              baseTemplate?: string;
              draft?: string;
            } | null)
          : null;
        if (saved?.baseTemplate === p.generated_prompt && typeof saved.draft === 'string') {
          initialTemplate = saved.draft;
          setRestoredDraft(saved.draft !== p.generated_prompt);
        } else {
          setRestoredDraft(false);
        }
      } catch {
        if (draftStorageKey) localStorage.removeItem(draftStorageKey);
        setRestoredDraft(false);
      }
      setTemplateText(initialTemplate);
      setVersions(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompt.');
    } finally {
      setIsLoading(false);
    }
  }, [applyPrompt, draftStorageKey, promptId]);

  /**
   * Conflict recovery: pull the other session's saved state in without
   * touching `templateText`. The local edit stays on screen as an unsaved
   * draft, so the user can Update to overwrite or Discard to take theirs —
   * the two actions the conflict message promises.
   */
  const handleReloadAfterConflict = async () => {
    setIsSaving(true);
    setError('');
    try {
      const [p, v] = await Promise.all([
        ApiClient.getPromptById(promptId),
        ApiClient.getPromptVersions(promptId),
      ]);
      applyPrompt(p);
      setVersions(v);
      setConflict('');
      showSaveNotice('Reloaded the latest saved version — your unsaved edit is still here.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload prompt.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  // A prompt that could not be loaded still gets a titled page — a browser tab
  // reading the bare app name says nothing about which of several tabs failed.
  const isNotFound = !prompt && error.toLowerCase().includes('not found');

  useEffect(() => {
    if (isLoading) return;
    document.title = pageTitle(
      prompt
        ? (prompt.name ?? 'Untitled')
        : isNotFound
          ? 'Prompt not found'
          : 'Could not load prompt',
    );
    return () => {
      document.title = pageTitle();
    };
  }, [isLoading, isNotFound, prompt, searchParams]);

  useEffect(() => {
    if (!prompt || !draftStorageKey) return;
    if (templateText === prompt.generated_prompt) {
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      return;
    }
    localStorage.setItem(
      draftStorageKey,
      JSON.stringify({ baseTemplate: prompt.generated_prompt, draft: templateText }),
    );
  }, [draftStorageKey, prompt, templateText]);

  useEffect(() => {
    AuthService.getCurrentUser()
      .then(setCurrentUser)
      .catch(() => {});
  }, []);

  // Best-effort: the export snippet names the model the user actually connected,
  // so copying it doesn't hand them a call against a model they never set up.
  // A failure just leaves the snippet on its documented fallback.
  useEffect(() => {
    ApiClient.getPromptsConfig()
      .then((config) => setConnectedModel(config.model))
      .catch(() => {});
  }, []);

  const refreshVersions = async () => {
    setVersions(await ApiClient.getPromptVersions(promptId));
  };

  const runEval = useCallback(async () => {
    setEvalRunStatus('running');
    try {
      await ApiClient.createEvalRun(promptId);
      setEvalRunStatus('complete');
    } catch {
      setEvalRunStatus('failed');
    } finally {
      setTimeout(() => setEvalRunStatus(''), 4000);
    }
  }, [promptId]);

  // After an Update or accepted refinement: auto-run the eval set if the user
  // opted in, otherwise nudge them to re-score the new version.
  const maybeAutoRunEval = useCallback(async () => {
    try {
      const cases = await ApiClient.listEvalCases(promptId);
      if (cases.length === 0) return;
      if (currentUser?.auto_run_eval_on_update) {
        await runEval();
      } else {
        setShowEvalCta(true);
      }
    } catch {
      // Fetching the case list is best-effort; a failure just skips the nudge.
    }
  }, [currentUser, promptId, runEval]);

  const handleUpdate = async (name?: string) => {
    if (!templateText.trim()) {
      setError('Prompt template cannot be empty.');
      return;
    }
    setIsSaving(true);
    setIsUpdating(true);
    setError('');
    setConflict('');
    try {
      const updated = await patchPrompt(() => ({
        generated_prompt: templateText,
        ...(name ? { name } : {}),
      }));
      if (!updated) return;
      setTemplateText(updated.generated_prompt);
      setRestoredDraft(false);
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      setShowSaveDialog(false);
      await refreshVersions();
      showSaveNotice('Changes saved.');
      maybeAutoRunEval();
    } catch (err) {
      reportMutationError(err, 'Failed to update prompt.');
    } finally {
      setIsUpdating(false);
      setIsSaving(false);
    }
  };

  const handlePrimaryAction = () => {
    if (!templateText.trim()) {
      setError('Prompt template cannot be empty.');
      return;
    }
    if (prompt?.name) {
      handleUpdate();
    } else {
      setShowSaveDialog(true);
    }
  };

  const handleRestore = async (versionId: number) => {
    setIsSaving(true);
    setError('');
    try {
      const updated = await enqueue(() => ApiClient.restorePromptVersion(promptId, versionId));
      applyPrompt(updated);
      setTemplateText(updated.generated_prompt);
      setRestoredDraft(false);
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      await refreshVersions();
      showSaveNotice('Version restored.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore version.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = async (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    try {
      await patchPrompt((current) =>
        (current.tags ?? []).includes(trimmed)
          ? null
          : { tags: [...(current.tags ?? []), trimmed] },
      );
    } catch (err) {
      reportMutationError(err, 'Failed to add tag.');
    }
  };

  const handleRemoveTag = async (tag: string) => {
    try {
      await patchPrompt((current) => ({
        tags: (current.tags ?? []).filter((t) => t !== tag),
      }));
    } catch (err) {
      reportMutationError(err, 'Failed to remove tag.');
    }
  };

  const handleVariableMetadataChange = async (
    label: string,
    patch: { type?: 'text' | 'number' | 'boolean' | 'list'; description?: string | null }
  ) => {
    try {
      await patchPrompt((current) => {
        const existing = current.variable_metadata?.[label] ?? {
          type: 'text' as const,
          description: null,
        };
        return {
          variable_metadata: {
            ...(current.variable_metadata ?? {}),
            [label]: { ...existing, ...patch },
          },
        };
      });
    } catch (err) {
      reportMutationError(err, 'Failed to update variable.');
    }
  };

  const handleRefineAccepted = async (draft: string) => {
    setIsSaving(true);
    setError('');
    try {
      const updated = await patchPrompt(() => ({
        generated_prompt: draft,
        // Version rows store the state being replaced, so describe that
        // snapshot rather than the new live state produced by this update.
        note: 'Before AI refinement',
      }));
      if (!updated) return;
      setTemplateText(updated.generated_prompt);
      setRestoredDraft(false);
      await refreshVersions();
      maybeAutoRunEval();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      reportMutationError(err, 'Failed to save refined prompt.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading prompt...</p>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className={styles.loadError} role="alert">
        <h1>{isNotFound ? 'Prompt not found' : 'Could not load prompt'}</h1>
        <p>{error || 'The prompt could not be loaded.'}</p>
        <div className={styles.loadErrorActions}>
          {!isNotFound && <Button variant="primary" onClick={load}>Retry</Button>}
          <Link href="/library">Back to Library</Link>
        </div>
      </div>
    );
  }



  return (
    <div className={styles.detail}>
      <div className={styles.breadcrumb}>
        <Link href="/library">Library</Link>
        <span>/</span>
        <span className={styles.breadcrumbCurrent} title={prompt.name ?? 'Untitled'}>
          {prompt.name ?? 'Untitled'}
        </span>
      </div>

      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.name} title={prompt.name ?? 'Untitled'}>
            {prompt.name ?? 'Untitled'}
          </h1>
          <div className={styles.meta}>
            {prompt.folder ? `${prompt.folder} · ` : ''}Edited{' '}
            {formatDate(prompt.updated_at ?? prompt.created_at)}
          </div>
        </div>
        <div className={styles.headerActions}>
          {isDirty && (
            <div className={styles.draftStatus} role="status">
              <span>
                {restoredDraft
                  ? 'Unsaved draft — restored from this device'
                  : 'Unsaved draft'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTemplateText(prompt.generated_prompt);
                  setRestoredDraft(false);
                  if (draftStorageKey) localStorage.removeItem(draftStorageKey);
                }}
              >
                Discard
              </button>
            </div>
          )}
          <Link href={`/playground/${promptId}`} prefetch={false}>
            <Button variant="secondary">Test in playground</Button>
          </Link>
          <Button variant="primary" onClick={handlePrimaryAction} disabled={isSaving}>
            {isUpdating && <LoadingIcon tone="inherit" />}
            {prompt.name ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <ErrorStatusIcon tone="danger" />
          <span>{error}</span>
        </div>
      )}
      {conflict && (
        <div className={styles.conflictBanner} role="alert">
          <span className={styles.bannerMessage}>
            <ErrorStatusIcon tone="danger" />
            {conflict} Your edit was not saved — it is still here, and reloading keeps it.
          </span>
          <span className={styles.ctaActions}>
            <Button variant="secondary" onClick={handleReloadAfterConflict} disabled={isSaving}>
              Reload
            </Button>
            <button
              type="button"
              className={styles.ctaDismiss}
              aria-label="Dismiss conflict"
              onClick={() => setConflict('')}
            >
              ×
            </button>
          </span>
        </div>
      )}
      {saveNotice && (
        <div className={styles.statusBanner} role="status" aria-live="polite">
          <SuccessStatusIcon tone="success" />
          <span>{saveNotice}</span>
        </div>
      )}
      {evalRunStatus === 'running' && (
        <div className={styles.statusBanner} role="status" aria-live="polite">
          <InfoStatusIcon tone="info" />
          <span>Running evaluation…</span>
        </div>
      )}
      {evalRunStatus === 'complete' && (
        <div className={styles.statusBanner} role="status" aria-live="polite">
          <SuccessStatusIcon tone="success" />
          <span>Evaluation complete</span>
        </div>
      )}
      {evalRunStatus === 'failed' && (
        <div className={styles.errorBanner} role="alert">
          <ErrorStatusIcon tone="danger" />
          <span>Evaluation failed</span>
        </div>
      )}
      {showEvalCta && evalRunStatus === '' && (
        <div className={styles.ctaBanner}>
          <span className={styles.bannerMessage}>
            <InfoStatusIcon tone="info" />
            Template updated — run your eval set to score the new version.
          </span>
          <span className={styles.ctaActions}>
            <Button
              variant="secondary"
              onClick={() => {
                setShowEvalCta(false);
                runEval();
              }}
            >
              Run evaluation
            </Button>
            <button
              type="button"
              className={styles.ctaDismiss}
              aria-label="Dismiss"
              onClick={() => setShowEvalCta(false)}
            >
              ×
            </button>
          </span>
        </div>
      )}

      <div className={styles.tabs}>
        <button
          type="button"
          className={styles.tabButton}
          data-active={activeTab === 'configuration'}
          onClick={() => setActiveTab('configuration')}
        >
          Configuration
        </button>
        <button
          type="button"
          className={styles.tabButton}
          data-active={activeTab === 'evaluate'}
          onClick={() => setActiveTab('evaluate')}
        >
          Evaluate
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${styles.refineTab}`}
          data-active={activeTab === 'refine'}
          onClick={() => setActiveTab('refine')}
        >
          <RefineIcon size="md" tone="accent" />
          <span>Refine</span>
        </button>
      </div>

      {activeTab !== 'refine' && (
        <nav className={styles.historyLinks} aria-label="Related history">
          <button
            type="button"
            onClick={() => {
              setActiveTab('configuration');
              setTimeout(() => {
                document.getElementById('version-history')?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }}
          >
            Version history
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('evaluate');
              setTimeout(() => {
                document.getElementById('run-history')?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }}
          >
            Evaluation run history
          </button>
        </nav>
      )}

      {activeTab === 'configuration' && (
        <ConfigurationTab
          prompt={prompt}
          templateText={templateText}
          setTemplateText={(value) => setTemplateText(value)}
          versions={versions}
          isSaving={isSaving}
          onRestore={handleRestore}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onVariableMetadataChange={handleVariableMetadataChange}
          currentUserUsername={currentUser?.username}
          connectedModel={connectedModel}
        />
      )}
      {activeTab === 'evaluate' && <EvaluateTab key={prompt.id} prompt={prompt} currentUser={currentUser} />}
      {activeTab === 'refine' && (
        <RefineTab prompt={prompt} onAccepted={handleRefineAccepted} />
      )}

      <SavePromptDialog
        isOpen={showSaveDialog}
        currentName=""
        onSave={(name) => handleUpdate(name)}
        onCancel={() => setShowSaveDialog(false)}
      />
    </div>
  );
}
