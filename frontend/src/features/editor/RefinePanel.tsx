'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import AICallContext from '@/components/ui/AICallContext';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { ApiClient } from '@/lib/api';
import { diffWords } from '@/lib/diff';
import type { EvalRun } from '@/types/evaluation';
import type { PromptField, PromptsConfigResponse } from '@/types/prompt';
import { DraftCheck, TestResultPicker, evidenceCandidates } from './RefineTests';
import styles from './RefinePanel.module.css';

interface RefinePanelProps {
  open: boolean;
  /** A saved prompt's ID: its test results can guide and check the draft. */
  promptId?: number;
  fields: PromptField[];
  aiAvailable: boolean;
  aiConfig: PromptsConfigResponse | null;
  aiConfigLoading?: boolean;
  aiConfigError?: boolean;
  onClose: () => void;
  onApply: (fields: PromptField[]) => void;
}

const REVIEW_OPTIONS = [
  { value: 'changes', label: 'Changes' },
  { value: 'full', label: 'Full draft' },
] as const;

export default function RefinePanel({ open, promptId, fields, aiAvailable, aiConfig, aiConfigLoading = false, aiConfigError = false, onClose, onApply }: RefinePanelProps) {
  const [source, setSource] = useState<PromptField[] | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState<PromptField[] | null>(null);
  const [review, setReview] = useState(false);
  const [view, setView] = useState<'changes' | 'full'>('changes');
  const [busy, setBusy] = useState<'questions' | 'draft' | null>(null);
  const [error, setError] = useState('');
  const [tests, setTests] = useState<{ runs: EvalRun[]; caseCount: number } | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const sourceKey = JSON.stringify(source);
  const stale = source !== null && sourceKey !== JSON.stringify(fields);
  const changed = draft?.some((field, i) => field.content !== source?.[i]?.content);
  // Applying keeps the session: after Undo in the editor the same draft can be applied again.
  const plain = (list: PromptField[]) => JSON.stringify(list.map(({ name, content }) => ({ name, content })));
  const applied = !!draft && changed && plain(draft) === plain(fields);
  const latestRun = tests?.runs[0];
  const evidence = promptId !== undefined && latestRun && chosen.length
    ? { prompt_id: promptId, run_id: latestRun.id, result_ids: chosen } : undefined;

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Reloaded on each opening so runs made in Evaluate meanwhile are offered.
  useEffect(() => {
    if (!open || promptId === undefined || !aiAvailable) return;
    let active = true;
    Promise.all([ApiClient.getEvalRuns(promptId, 20), ApiClient.getEvalCases(promptId)])
      .then(([runs, cases]) => {
        if (!active) return;
        setTests({ runs, caseCount: cases.length });
        // A new latest run makes earlier choices meaningless.
        setChosen((current) => runs[0] && current.every((id) => runs[0].results.some((r) => r.id === id)) ? current : []);
      })
      .catch(() => { /* Refinement works without test results. */ });
    return () => { active = false; };
  }, [open, promptId, aiAvailable]);
  useEffect(() => () => { requestRef.current += 1; }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const opener = document.activeElement as HTMLElement | null;
    const show = () => {
      const mobile = window.innerWidth <= 1200;
      if (dialog.open && (dialog.getAttribute('aria-modal') === 'true') === mobile) return;
      // Native modal dialogs make the rest of the page inert on phones.
      dialog.close();
      if (mobile) {
        dialog.showModal();
        dialog.setAttribute('aria-modal', 'true');
      } else {
        dialog.show();
        dialog.removeAttribute('aria-modal');
      }
      headingRef.current?.focus();
    };
    show();
    window.addEventListener('resize', show);
    return () => {
      window.removeEventListener('resize', show);
      dialog.close();
      opener?.focus();
    };
  }, [open]);

  // Keep a closed session in memory, but never accept a result after unmount.
  const findQuestions = async (force = false) => {
    if (busy) return;
    const id = ++requestRef.current;
    const snapshot = fields.map((field) => ({ ...field }));
    setSource(snapshot);
    setError('');
    setBusy('questions');
    try {
      const result = await ApiClient.getRefinementQuestions(snapshot, force);
      if (id !== requestRef.current) return;
      setQuestions(result.questions);
      setAnswers(result.questions.map(() => ''));
      setDraft(null);
      setReview(false);
    } catch (err) {
      if (id === requestRef.current) setError(err instanceof Error ? err.message : 'Could not find questions. Please try again.');
    } finally {
      if (id === requestRef.current) setBusy(null);
    }
  };

  const requestDraft = async (snapshot: PromptField[], pairs: { question: string; answer: string }[]) => {
    const id = ++requestRef.current;
    setError('');
    setBusy('draft');
    try {
      const result = await ApiClient.createRefinementDraft(snapshot, pairs, evidence);
      if (id !== requestRef.current) return;
      setDraft(result.fields);
      setReview(true);
      setView('changes');
      headingRef.current?.focus();
    } catch (err) {
      if (id === requestRef.current) setError(err instanceof Error ? err.message : 'Could not create a draft. Please try again.');
    } finally {
      if (id === requestRef.current) setBusy(null);
    }
  };

  const createDraft = () => {
    if (busy || stale || !source || !questions) return;
    void requestDraft(source, questions
      .map((question, i) => ({ question, answer: answers[i].trim() }))
      .filter((pair) => pair.answer));
  };

  // No questions: the AI tightens the current sections without new requirements.
  const improve = () => {
    if (busy || stale) return;
    const snapshot = fields.map((field) => ({ ...field }));
    setSource(snapshot);
    void requestDraft(snapshot, []);
  };

  const reset = () => {
    requestRef.current += 1;
    setSource(null);
    setQuestions(null);
    setAnswers([]);
    setDraft(null);
    setReview(false);
    setBusy(null);
    setError('');
    setChosen([]);
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.panel}
      aria-labelledby="refine-heading"
      onCancel={(event) => { event.preventDefault(); onCloseRef.current(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); }
      }}
    >
      <div className={styles.head}>
        <div>
          <h2 id="refine-heading" ref={headingRef} tabIndex={-1}>Refine prompt</h2>
          <p className={styles.steps}>
            <span aria-current={!review ? 'step' : undefined}>Clarify</span>
            <span aria-hidden="true"> / </span>
            <span aria-current={review ? 'step' : undefined}>Review</span>
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close refinement">×</Button>
      </div>

      <div className={styles.body} aria-busy={busy !== null}>
        <>{aiConfigLoading ? <p role="status">Checking AI connection…</p> : aiConfigError ? <p role="status">Could not check the AI connection. Reload to retry.</p> : <AICallContext config={aiConfig} />}</>
        {aiConfigLoading || aiConfigError ? null : !aiAvailable ? (
          <>
            <p>{aiConfig?.budget_exhausted ? 'The API budget has been reached.' : 'Refinement needs an AI connection.'}</p>
            <p className={styles.hint}>Connect a provider in Settings to find questions and create a revised draft.</p>
            <Link href="/settings#s-api" className={styles.link}>Open Settings</Link>
          </>
        ) : applied ? (
          <>
            <p>These changes are applied to your draft.</p>
            <p className={styles.hint}>Save in the editor to keep them, or use Undo there to go back; this draft stays here to apply again.</p>
            <Button variant="secondary" onClick={reset}>Start again</Button>
          </>
        ) : stale ? (
          <>
            <p>Your prompt changed since this refinement started.</p>
            <p className={styles.hint}>Start again to refine your current sections.</p>
            <Button variant="secondary" onClick={reset}>Start again</Button>
          </>
        ) : review && draft && source ? (
          <>
            <p className={styles.hint}>Applying updates your draft. Save in the editor to keep the changes. You can Undo after applying.</p>
            <SegmentedControl aria-label="Draft view" options={REVIEW_OPTIONS} value={view} onChange={setView} />
            {!changed && <p className={styles.empty}>The draft is identical to your prompt.</p>}
            {draft.map((field, i) => {
              const same = field.content === source[i].content;
              return same && view === 'changes' ? (
                <details key={field.name} className={styles.section}>
                  <summary>{field.name}<span className={styles.unchanged}>Unchanged</span></summary>
                  <p className={styles.prose}>{field.content}</p>
                </details>
              ) : (
                <section key={field.name} className={styles.section} aria-label={field.name}>
                  <h3>{field.name}</h3>
                  <p className={styles.prose} aria-label={view === 'changes' ? `Changes to ${field.name}` : `Draft ${field.name}`}>
                    {view === 'full' ? field.content : diffWords(source[i].content, field.content).map((token, j) =>
                      token.type === 'added' ? <ins key={j}>{token.text}</ins> :
                      token.type === 'removed' ? <del key={j}>{token.text}</del> : token.text)}
                  </p>
                </section>
              );
            })}
            {promptId !== undefined && tests && tests.caseCount > 0 && changed && (
              <DraftCheck key={plain(draft)} promptId={promptId} caseCount={tests.caseCount} runs={tests.runs}
                source={source} draft={draft} disabled={!aiAvailable} />
            )}
          </>
        ) : questions === null ? (
          <>
            <p>Answer a few questions, or skip them, then review a revised version of your prompt.</p>
            <p className={styles.hint}>Nothing is applied or saved automatically.</p>
          </>
        ) : questions.length === 0 ? (
          <>
            <p>No important gaps were identified.</p>
            <p className={styles.hint}>You can keep your prompt as it is, improve its wording without questions, or ask for optional questions.</p>
          </>
        ) : (
          <>
            <p className={styles.hint}>Answer what matters. You can leave individual questions blank.</p>
            {questions.map((question, i) => (
              <label key={i} className={styles.question}>
                <span>{question}</span>
                <textarea
                  value={answers[i]}
                  onChange={(event) => setAnswers((current) => current.map((answer, j) => j === i ? event.target.value : answer))}
                  maxLength={2000}
                  rows={3}
                  disabled={busy !== null}
                />
              </label>
            ))}
          </>
        )}
        {aiAvailable && !applied && !stale && !review && latestRun && evidenceCandidates(latestRun).length > 0 && (
          <TestResultPicker run={latestRun} chosen={chosen} disabled={busy !== null} onChange={setChosen} />
        )}
        {error && <p className={styles.error} role="alert">{error}{error.includes('Settings →') && <> <Link href="/settings#s-api" className={styles.link}>Open Settings</Link></>}</p>}
        {busy && <p className={styles.hint} role="status">{busy === 'questions' ? 'Finding questions…' : 'Creating draft…'}</p>}
      </div>

      <div className={styles.foot}>
        {review && !stale ? (
          <>
            <Button variant="ghost" onClick={() => { setReview(false); setError(''); }}>{questions?.length ? 'Back to answers' : 'Back'}</Button>
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Discard draft</Button>
            <Button variant="primary" disabled={!changed || !aiAvailable} onClick={() => {
              if (draft && !stale) onApply(draft);
            }}>Apply changes</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Back to editor</Button>
            {aiAvailable && !stale && (
              questions === null || questions.length === 0 ? (
                <>
                  <Button variant="secondary" disabled={busy !== null} onClick={improve}>Improve without questions</Button>
                  <Button variant={questions === null ? 'primary' : 'secondary'} disabled={busy !== null} onClick={() => findQuestions(questions !== null)}>
                    {questions === null ? 'Find questions' : 'Ask more questions'}
                  </Button>
                </>
              ) : (
                <Button variant="primary" disabled={busy !== null || !answers.some((answer) => answer.trim())} onClick={createDraft}>Create draft</Button>
              )
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
