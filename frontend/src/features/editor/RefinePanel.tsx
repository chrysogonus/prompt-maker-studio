'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import AICallContext from '@/components/ui/AICallContext';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { ApiClient } from '@/lib/api';
import { diffWords } from '@/lib/diff';
import type { PromptField, PromptsConfigResponse } from '@/types/prompt';
import styles from './RefinePanel.module.css';

interface RefinePanelProps {
  open: boolean;
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

export default function RefinePanel({ open, fields, aiAvailable, aiConfig, aiConfigLoading = false, aiConfigError = false, onClose, onApply }: RefinePanelProps) {
  const [source, setSource] = useState<PromptField[] | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState<PromptField[] | null>(null);
  const [review, setReview] = useState(false);
  const [view, setView] = useState<'changes' | 'full'>('changes');
  const [busy, setBusy] = useState<'questions' | 'draft' | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const sourceKey = JSON.stringify(source);
  const stale = source !== null && sourceKey !== JSON.stringify(fields);
  const changed = draft?.some((field, i) => field.content !== source?.[i]?.content);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
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

  const createDraft = async () => {
    if (busy || stale || !source || !questions) return;
    const id = ++requestRef.current;
    setError('');
    setBusy('draft');
    try {
      const result = await ApiClient.createRefinementDraft(source, questions
        .map((question, i) => ({ question, answer: answers[i].trim() }))
        .filter((pair) => pair.answer));
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

  const reset = () => {
    requestRef.current += 1;
    setSource(null);
    setQuestions(null);
    setAnswers([]);
    setDraft(null);
    setReview(false);
    setBusy(null);
    setError('');
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
          </>
        ) : questions === null ? (
          <>
            <p>Answer a few questions, then review a revised version of your prompt.</p>
            <p className={styles.hint}>Uses your AI connection. Nothing is applied or saved automatically.</p>
          </>
        ) : questions.length === 0 ? (
          <>
            <p>No important gaps were identified.</p>
            <p className={styles.hint}>You can keep your prompt as it is, or ask for optional questions.</p>
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
        {error && <p className={styles.error} role="alert">{error}</p>}
        {busy && <p className={styles.hint} role="status">{busy === 'questions' ? 'Finding questions…' : 'Creating draft…'}</p>}
      </div>

      <div className={styles.foot}>
        {review && !stale ? (
          <>
            <Button variant="ghost" onClick={() => { setReview(false); setError(''); }}>Back to answers</Button>
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Discard draft</Button>
            <Button variant="primary" disabled={!changed || !aiAvailable} onClick={() => {
              if (draft && !stale) { onApply(draft); reset(); }
            }}>Apply changes</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Back to editor</Button>
            {aiAvailable && !stale && (
              questions === null || questions.length === 0 ? (
                <Button variant={questions === null ? 'primary' : 'secondary'} disabled={busy !== null} onClick={() => findQuestions(questions !== null)}>
                  {questions === null ? 'Find questions' : 'Ask more questions'}
                </Button>
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
