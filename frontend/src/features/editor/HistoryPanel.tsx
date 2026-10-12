'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { diffWords } from '@/lib/diff';
import { parseServerDate } from '@/lib/relativeTime';
import { PromptHistoryResponse, PromptVersionResponse } from '@/types/prompt';
import styles from './PromptEditor.module.css';
import { snapshot } from './editorState';

interface HistoryPanelProps {
  current: PromptHistoryResponse;
  /** Prior states, newest first as the API returns them. */
  versions: PromptVersionResponse[];
  dirty: boolean;
  onClose: () => void;
  onRestore: (versionId: number, versionNumber: number) => Promise<void>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return parseServerDate(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryPanel({
  current,
  versions,
  dirty,
  onClose,
  onRestore,
}: HistoryPanelProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const selected = versions.find((version) => version.id === selectedId) ?? null;
  // Version rows are the states before each edit, so the live prompt is one newer.
  const sameSettings = !selected || selected.variable_metadata == null || snapshot([], selected.variable_metadata) === snapshot([], current.variable_metadata);
  const currentNumber = Math.max(0, ...versions.map((version) => version.version_number)) + 1;

  const restore = async (version: PromptVersionResponse) => {
    setRestoring(true);
    try {
      await onRestore(version.id, version.version_number);
      setSelectedId(null);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <aside className={styles.history} aria-label="Version history">
      <div className={styles.historyHead}>
        <h2>History</h2>
        <button type="button" className={styles.historyClose} onClick={onClose} aria-label="Close history">
          ×
        </button>
      </div>

      {selected ? (
        <div className={styles.historyBody}>
          <button type="button" className={styles.link} onClick={() => setSelectedId(null)}>
            All versions
          </button>
          <h3 className={styles.diffTitle}>Version {selected.version_number} compared with current</h3>
          <p className={styles.diffMeta}>
            {formatDate(selected.created_at)}
            {selected.note ? `. ${selected.note}` : ''}
          </p>
          {selected.legacy_note && (
            <details className={styles.diffMeta}><summary>Original history note</summary>
              <p>{selected.legacy_note} (recorded before this version was replaced)</p>
            </details>
          )}
          {!sameSettings && <p className={styles.diffMeta}>Variable settings also differ from the current version. Restoring brings back this version’s saved settings.</p>}
          <p className={styles.diffLegend}>
            <ins>Added</ins> and <del>removed</del> since this version.
          </p>
          {selected.generated_prompt === current.generated_prompt ? (
            <p className={styles.diffMeta}>Same text as the current version.</p>
          ) : (
            <div className={styles.diff} tabIndex={0} aria-label="Changes since this version">
              {diffWords(selected.generated_prompt, current.generated_prompt).map((token, i) =>
                token.type === 'added' ? (
                  <ins key={i}>{token.text}</ins>
                ) : token.type === 'removed' ? (
                  <del key={i}>{token.text}</del>
                ) : (
                  <span key={i}>{token.text}</span>
                ),
              )}
            </div>
          )}
          <div className={styles.diffActions}>
            <Button
              variant="secondary"
              onClick={() => restore(selected)}
              disabled={
                dirty || restoring || (sameSettings && selected.generated_prompt === current.generated_prompt)
              }
            >
              {restoring ? 'Restoring…' : `Restore version ${selected.version_number}`}
            </Button>
            <span className={styles.diffHint}>
              {dirty
                ? 'Save or discard your edits before restoring.'
                : 'The current version stays in history, so you can undo this.'}
            </span>
          </div>
        </div>
      ) : (
        <ol className={styles.historyBody}>
          <li>
            <div className={styles.version} data-current="true">
              <span className={styles.versionTitle}>Version {currentNumber}, current</span>
              <span className={styles.versionMeta}>{formatDate(current.updated_at ?? current.created_at)}</span>
              {current.current_note && <span className={styles.versionNote}>{current.current_note}</span>}
            </div>
          </li>
          {versions.map((version) => (
            <li key={version.id}>
              <button type="button" className={styles.version} onClick={() => setSelectedId(version.id)}>
                <span className={styles.versionTitle}>Version {version.version_number}</span>
                <span className={styles.versionMeta}>{formatDate(version.created_at)}</span>
                {version.note && <span className={styles.versionNote}>{version.note}</span>}
              </button>
            </li>
          ))}
          {versions.length === 0 && (
            <li className={styles.versionMeta}>Each save that changes the prompt adds a version here.</li>
          )}
        </ol>
      )}
    </aside>
  );
}
