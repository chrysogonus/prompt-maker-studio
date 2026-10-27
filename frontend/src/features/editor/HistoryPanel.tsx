'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { ApiClient } from '@/lib/api';
import { diffWords } from '@/lib/diff';
import { parseServerDate } from '@/lib/relativeTime';
import type { EvalRun } from '@/types/evaluation';
import { PromptHistoryResponse, PromptVersionResponse } from '@/types/prompt';
import styles from './PromptEditor.module.css';
import { snapshot, type OperationResult } from './editorState';

interface HistoryPanelProps {
  current: PromptHistoryResponse;
  /** Prior states, newest first as the API returns them. */
  versions: PromptVersionResponse[];
  dirty: boolean;
  onClose: () => void;
  onRestore: (versionId: number, versionNumber: number) => Promise<OperationResult>;
  /** Marks a version number as known good; 0 removes the mark. */
  onMarkKnownGood: (versionNumber: number) => Promise<OperationResult>;
}

/** The newest evaluation of this exact text; older runs only recorded a version number. */
function latestRun(runs: EvalRun[], text: string, versionNumber: number) {
  return runs.find((run) => run.tested_prompt === text)
    ?? runs.find((run) => run.tested_prompt === null && run.tested_version === versionNumber);
}

function TestSummary({ runs, text, versionNumber }: { runs: EvalRun[]; text: string; versionNumber: number }) {
  if (!runs.length) return null;
  const run = latestRun(runs, text, versionNumber);
  return <span className={styles.versionMeta}>
    {!run ? 'Not tested' : run.score === null ? 'Tested, no score yet' : `Tested · ${Math.round(run.score)}/100`}
  </span>;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return parseServerDate(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export default function HistoryPanel({
  current,
  versions,
  dirty,
  onClose,
  onRestore,
  onMarkKnownGood,
}: HistoryPanelProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [marking, setMarking] = useState(false);
  // ponytail: the newest 100 runs; older versions show "Not tested" beyond that.
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const knownGood = current.known_good_version ?? null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // A modal panel covers the page's notice (and makes it inert), so results are shown here too.
  const [modal, setModal] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  // As in Refine: on narrow screens the panel covers the page, so it is a modal dialog there.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const show = () => {
      const mobile = window.innerWidth <= 1200;
      if (dialog.open && (dialog.getAttribute('aria-modal') === 'true') === mobile) return;
      dialog.close();
      if (mobile) {
        dialog.showModal();
        dialog.setAttribute('aria-modal', 'true');
      } else {
        dialog.show();
        dialog.removeAttribute('aria-modal');
      }
      setModal(mobile);
      closeRef.current?.focus();
    };
    show();
    window.addEventListener('resize', show);
    return () => {
      window.removeEventListener('resize', show);
      dialog.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    ApiClient.getEvalRuns(current.id, 100)
      .then((loaded) => { if (active) setRuns(loaded); })
      .catch(() => { /* History works without test results. */ });
    return () => { active = false; };
  }, [current.id]);

  const mark = async (versionNumber: number) => {
    setMarking(true);
    try {
      const result = await onMarkKnownGood(versionNumber);
      setStatus({ text: result.text, error: !result.ok });
    } finally {
      setMarking(false);
      // The button was disabled while saving, which drops focus out of the non-modal panel
      // and with it Escape; keep focus in the panel.
      headingRef.current?.focus();
    }
  };
  const markButton = (versionNumber: number) => (
    <Button variant="ghost" className={styles.versionAction} disabled={marking} onClick={() => void mark(knownGood === versionNumber ? 0 : versionNumber)}>
      {knownGood === versionNumber ? 'Remove known-good mark' : 'Mark as known good'}
    </Button>
  );
  const selected = versions.find((version) => version.id === selectedId) ?? null;
  // Version rows are the states before each edit, so the live prompt is one newer.
  const sameSettings = !selected || selected.variable_metadata == null || snapshot([], selected.variable_metadata) === snapshot([], current.variable_metadata);
  const currentNumber = Math.max(0, ...versions.map((version) => version.version_number)) + 1;
  // A version is stored when the next save replaces it, so it was written when the one
  // before it was replaced; version 1 was written when the prompt was created.
  const replacedAt = new Map(versions.map((version) => [version.version_number, version.created_at]));
  const writtenAt = (number: number) => number === 1 ? current.created_at : replacedAt.get(number - 1);

  const restore = async (version: PromptVersionResponse) => {
    setRestoring(true);
    try {
      const result = await onRestore(version.id, version.version_number);
      setStatus({ text: result.text, error: !result.ok });
      // A failed restore keeps the comparison, with the reason.
      if (!result.ok) return;
      setSelectedId(null);
      // The Restore button goes with the comparison; keep focus in the panel.
      headingRef.current?.focus();
    } finally {
      setRestoring(false);
    }
  };

  // Close the native dialog first: while it is modal the rest of the page is inert, so the
  // parent could not move focus back to Tools.
  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.history}
      aria-label="Version history"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}
    >
      <div className={styles.historyHead}>
        <h2 ref={headingRef} tabIndex={-1}>History</h2>
        <button ref={closeRef} type="button" className={styles.historyClose} onClick={close} aria-label="Close history">
          ×
        </button>
      </div>
      {modal && status && <p className={styles.historyStatus} role={status.error ? 'alert' : 'status'} data-tone={status.error ? 'error' : undefined}>{status.text}</p>}

      {selected ? (
        <div className={styles.historyBody}>
          <button type="button" className={styles.link} onClick={() => { setSelectedId(null); setStatus(null); }}>
            All versions
          </button>
          <h3 className={styles.diffTitle}>Version {selected.version_number} compared with current</h3>
          {knownGood === selected.version_number && <p className={styles.diffMeta}>This is your known-good version.</p>}
          <TestSummary runs={runs} text={selected.generated_prompt} versionNumber={selected.version_number} />
          <p className={styles.diffMeta}>
            {formatDate(writtenAt(selected.version_number) ?? selected.created_at)}
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
          {markButton(selected.version_number)}
        </div>
      ) : (
        <ol className={styles.historyBody}>
          <li>
            <div className={styles.version} data-current="true">
              <span className={styles.versionTitle}>Version {currentNumber}, current{knownGood === currentNumber ? ' · known good' : ''}</span>
              <span className={styles.versionMeta}>{formatDate(writtenAt(currentNumber) ?? current.created_at)}</span>
              {current.current_note && <span className={styles.versionNote}>{current.current_note}</span>}
              <TestSummary runs={runs} text={current.generated_prompt} versionNumber={currentNumber} />
              {markButton(currentNumber)}
            </div>
          </li>
          {versions.map((version) => (
            <li key={version.id}>
              <button type="button" className={styles.version} onClick={() => { setSelectedId(version.id); setStatus(null); }}>
                <span className={styles.versionTitle}>Version {version.version_number}{knownGood === version.version_number ? ' · known good' : ''}</span>
                <span className={styles.versionMeta}>{formatDate(writtenAt(version.version_number) ?? version.created_at)}</span>
                {version.note && <span className={styles.versionNote}>{version.note}</span>}
                <TestSummary runs={runs} text={version.generated_prompt} versionNumber={version.version_number} />
              </button>
            </li>
          ))}
          {versions.length === 0 && (
            <li className={styles.versionMeta}>Each save that changes the prompt adds a version here.</li>
          )}
        </ol>
      )}
    </dialog>
  );
}
