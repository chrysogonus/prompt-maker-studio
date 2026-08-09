/**
 * The Editor Detail "Configuration" tab: template textarea, version
 * history with restore, a Variables panel (type/description per detected
 * `{{variable}}`), and tag chips. `templateText` is a controlled prop
 * owned by EditorDetail, since the header's Update action operates on it
 * regardless of which tab is active.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Textarea from '../ui/Textarea';
import PreflightPanel from '../ui/PreflightPanel';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Tag from '../ui/Tag';
import Button from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import {
  ActionCompleteIcon,
  CompareVersionIcon,
  CopyIcon,
  RestoreVersionIcon,
  VersionNodeIcon,
  WrapLinesIcon,
} from '../ui/icon';
import Tooltip from '../ui/Tooltip';
import { extractPromptPlaceholders } from '@/lib/placeholders';
import { runPreflightChecks } from '@/lib/preflight';
import { diffWords } from '@/lib/diff';
import { FALLBACK_SNIPPET_MODEL, buildSnippetVariables, generatePythonSnippet, generateTypeScriptSnippet } from '@/lib/codeSnippets';
import { PromptHistoryResponse, PromptVersionResponse, VariableMetadataItem } from '@/types/prompt';
import styles from './ConfigurationTab.module.css';

const DIFF_CLASS: Record<'added' | 'removed' | 'unchanged', string> = {
  added: styles.diffAdded,
  removed: styles.diffRemoved,
  unchanged: styles.diffUnchanged,
};

type SnippetLanguage = 'python' | 'typescript';

const SNIPPET_LANG_OPTIONS = [
  { value: 'python' as const, label: 'Python' },
  { value: 'typescript' as const, label: 'TypeScript' },
];

interface ConfigurationTabProps {
  prompt: PromptHistoryResponse;
  templateText: string;
  setTemplateText: (value: string) => void;
  versions: PromptVersionResponse[];
  isSaving: boolean;
  onRestore: (versionId: number) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onVariableMetadataChange: (
    label: string,
    patch: Partial<VariableMetadataItem>
  ) => void;
  currentUserUsername?: string | null;
  /** The model on the user's provider connection, for the export snippet. */
  connectedModel?: string | null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

function formatFullDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

export default function ConfigurationTab({
  prompt,
  templateText,
  setTemplateText,
  versions,
  isSaving,
  onRestore,
  onAddTag,
  onRemoveTag,
  onVariableMetadataChange,
  currentUserUsername,
  connectedModel,
}: ConfigurationTabProps) {
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [snippetLang, setSnippetLang] = useState<SnippetLanguage>('python');
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [wrapSnippet, setWrapSnippet] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const previewedVersion = versions.find((v) => v.id === previewVersionId) ?? null;
  const versionDiff = previewedVersion
    ? diffWords(previewedVersion.generated_prompt, prompt.generated_prompt)
    : [];
  const hasVersionChanges = versionDiff.some((token) => token.type !== 'unchanged');
  const variables = extractPromptPlaceholders(templateText);
  // Runs against the live edit, not the saved template: the point is to catch a
  // structural mistake while the author is still looking at it. Advisory only —
  // Update never blocks on these, same as every other place preflight appears.
  const preflightWarnings = useMemo(
    () => runPreflightChecks(templateText, { variableMetadata: prompt.variable_metadata }),
    [prompt.variable_metadata, templateText],
  );
  const currentVersionNumber =
    versions.reduce((highest, version) => Math.max(highest, version.version_number), 0) + 1;
  const latestSnapshot = versions.reduce<PromptVersionResponse | null>(
    (latest, version) =>
      !latest || version.version_number > latest.version_number ? version : latest,
    null,
  );
  // The live row has no note of its own, so it is described by the transition
  // that produced it — i.e. the note on the most recent snapshot, which records
  // the state that transition replaced.
  const transitionLabel = (note: string | null | undefined) => {
    if (note === 'Before AI refinement') return 'AI refinement';
    if (note === 'Before restore') return 'Restored version';
    if (note?.startsWith('Restore to v')) return `Restored from v${note.slice('Restore to v'.length)}`;
    return note || 'Edit';
  };
  // A historical row is labelled by its own note. Reading the *previous*
  // version's note here left the auto-created pre-refinement snapshot labelled
  // "Edit", indistinguishable from every ordinary edit, so nothing marked the
  // version a user would want to roll a refinement back to.
  const versionLabel = (version: PromptVersionResponse) => {
    if (version.note?.startsWith('Restore to v')) {
      return `Before restore to v${version.note.slice('Restore to v'.length)}`;
    }
    if (version.note) return version.note;
    return version.version_number === 1 ? 'Initial version' : 'Edit';
  };
  const currentVersionLabel = latestSnapshot
    ? transitionLabel(latestSnapshot.note)
    : 'Initial version';
  const snippetVariables = buildSnippetVariables(variables, prompt.variable_metadata);
  const snippetModel = connectedModel || FALLBACK_SNIPPET_MODEL;
  const snippetCode =
    snippetLang === 'python'
      ? generatePythonSnippet(templateText, snippetVariables, snippetModel)
      : generateTypeScriptSnippet(templateText, snippetVariables, snippetModel);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippetCode);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      setSnippetCopied(true);
      copyTimerRef.current = window.setTimeout(() => setSnippetCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy snippet:', err);
    }
  };

  const handleAddTag = () => {
    const trimmed = tagDraft.trim();
    if (!trimmed) return;
    setTagDraft('');
    onAddTag(trimmed);
  };

  return (
    <div className={styles.grid}>
      <div className={styles.mainColumn}>
        <h2 className={styles.sectionLabel}>Prompt Configuration</h2>
        <Textarea
          mono
          value={templateText}
          onChange={(e) => setTemplateText(e.target.value)}
          disabled={isSaving}
          spellCheck={false}
          rows={12}
          aria-label="Prompt template"
        />
        <div className={styles.hint}>
          Wrap a word in double curly braces, like <code>{'{{variable_name}}'}</code>, to add a
          variable — it appears in the Variables panel and the Playground automatically.
        </div>

        <PreflightPanel warnings={preflightWarnings} />

        <h2 className={styles.sectionLabel} id="version-history">Version history</h2>
        <div className={styles.currentVersionRow} aria-label={`Current version v${currentVersionNumber}`}>
          <VersionNodeIcon size="sm" />
          <span className={styles.versionNumber}>v{currentVersionNumber}</span>
          <span className={styles.versionNote}>{currentVersionLabel}</span>
          <span className={styles.versionAuthor}>{currentUserUsername ?? '—'}</span>
          <span className={styles.versionDate} title={formatFullDateTime(prompt.updated_at ?? prompt.created_at)}>
            {formatDate(prompt.updated_at ?? prompt.created_at)}
          </span>
          <span className={styles.currentBadge}>Current</span>
        </div>
        {versions.length === 0 ? (
          <div className={styles.emptyState}>
            No prior versions yet — editing this prompt creates one automatically.
          </div>
        ) : (
          <div className={styles.versionList}>
            {versions.map((v) => {
              const hasChanges = diffWords(
                v.generated_prompt,
                prompt.generated_prompt,
              ).some((token) => token.type !== 'unchanged');
              const isSelected = previewVersionId === v.id;
              const toggleComparison = () => setPreviewVersionId(isSelected ? null : v.id);

              return (
                <div
                  key={v.id}
                  className={styles.versionRow}
                  data-selected={isSelected}
                >
                  <VersionNodeIcon size="sm" />
                  <button
                    type="button"
                    className={styles.versionSummary}
                    onClick={toggleComparison}
                  >
                    <span className={styles.versionNumber}>v{v.version_number}</span>
                    <span className={styles.versionNote}>{versionLabel(v)}</span>
                    <span className={styles.versionAuthor}>{v.author ?? '—'}</span>
                    <span className={styles.versionDate} title={formatFullDateTime(v.created_at)}>
                      {formatDate(v.created_at)}
                    </span>
                  </button>
                  <span className={styles.versionActions}>
                    <Tooltip content="Compare with current">
                      <button
                        type="button"
                        className={styles.versionAction}
                        aria-label="Compare with current"
                        aria-pressed={isSelected}
                        onClick={toggleComparison}
                      >
                        <CompareVersionIcon size="sm" tone="inherit" />
                      </button>
                    </Tooltip>
                    <Tooltip content="Restore this version">
                      <button
                        type="button"
                        className={styles.versionAction}
                        aria-label="Restore this version"
                        disabled={isSaving || !hasChanges}
                        onClick={() => {
                          onRestore(v.id);
                          setPreviewVersionId(null);
                        }}
                      >
                        <RestoreVersionIcon size="sm" tone="inherit" />
                      </button>
                    </Tooltip>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {previewedVersion && (
          <div className={styles.versionPreview}>
            <div className={styles.diffHeader}>
              <span>v{previewedVersion.version_number}</span>
              <span aria-hidden="true">→</span>
              <span>Current</span>
            </div>
            <div className={styles.diffBox} aria-label="Version comparison" tabIndex={0}>
              {hasVersionChanges ? (
                versionDiff.map((token, index) => (
                  <span key={index} className={DIFF_CLASS[token.type]}>
                    {token.text}
                  </span>
                ))
              ) : (
                <span className={styles.diffUnchanged}>No changes since this version.</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={styles.sideColumn}>
        <h2 className={styles.sectionLabel}>Variables</h2>
        {variables.length === 0 ? (
          <div className={styles.emptyState}>No variables detected in this template yet.</div>
        ) : (
          <div className={styles.variableList}>
            {variables.map((v) => {
              const meta = prompt.variable_metadata?.[v.label];
              return (
                <div key={v.key} className={styles.variableRow}>
                  <div className={styles.variableRowTop}>
                    <span className={styles.variableName}>{v.label}</span>
                    <Select
                      className={styles.variableTypeSelect}
                      value={meta?.type ?? 'text'}
                      onChange={(e) =>
                        onVariableMetadataChange(v.label, {
                          type: e.target.value as VariableMetadataItem['type'],
                        })
                      }
                      aria-label={`${v.label} type`}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="list">List</option>
                    </Select>
                  </div>
                  <Input
                    key={`${v.key}-desc`}
                    defaultValue={meta?.description ?? ''}
                    placeholder="Description (optional)"
                    maxLength={500}
                    className={styles.variableDescInput}
                    aria-label={`${v.label} description`}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value === (meta?.description ?? '')) return;
                      onVariableMetadataChange(v.label, { description: value || null });
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        <h2 className={styles.sectionLabel}>Tags</h2>
        <div className={styles.tagsRow}>
          {(prompt.tags ?? []).map((t) => (
            <Tag key={t} onRemove={() => onRemoveTag(t)}>
              {t}
            </Tag>
          ))}
          <Input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
            onBlur={handleAddTag}
            placeholder="+ Add tag"
            className={styles.tagInput}
            aria-label="Add tag"
          />
        </div>

        <h2 className={styles.sectionLabel}>Usage</h2>
        <div className={styles.usageCard}>
          <div className={styles.usageValue}>{prompt.run_count}</div>
          <div className={styles.usageHint}>total runs</div>
        </div>

        <h2 className={styles.sectionLabel}>Export Code</h2>
        <div className={styles.snippetPanel}>
          <div className={styles.snippetHeader}>
            <SegmentedControl
              aria-label="Snippet language"
              options={SNIPPET_LANG_OPTIONS}
              value={snippetLang}
              onChange={setSnippetLang}
            />
            <Button
              variant="secondary"
              className={styles.copyButton}
              onClick={handleCopySnippet}
            >
              <span className={styles.copyIconSlot} data-copied={snippetCopied}>
                <CopyIcon size="sm" className={styles.copyDefaultIcon} />
                <ActionCompleteIcon
                  size="sm"
                  tone="success"
                  className={styles.copySuccessIcon}
                />
              </span>
              Copy
            </Button>
            <Button
              variant="secondary"
              className={styles.wrapButton}
              aria-pressed={wrapSnippet}
              onClick={() => setWrapSnippet((value) => !value)}
            >
              <WrapLinesIcon size="sm" tone={wrapSnippet ? 'accent' : 'muted'} />
              Wrap lines
            </Button>
          </div>
          <pre
            className={`${styles.snippetCode} ${wrapSnippet ? styles.snippetCodeWrapped : ''}`}
            role="region"
            aria-label={`${snippetLang} integration snippet`}
            tabIndex={0}
          >
            {snippetCode}
          </pre>
        </div>
      </div>
    </div>
  );
}
