'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { ApiClient } from '@/lib/api';
import { storageKey } from '@/lib/branding';
import { diffWords } from '@/lib/diff';
import { openInApp } from '@/lib/openInApp';
import styles from '@/components/public/Tools.module.css';

/** The prompt checker hands its text over under this key; read once. */
export const refinerInputKey = () => storageKey('refiner-input');

const EXAMPLE = 'Write a summary of {{notes}} for my team.';

export default function PromptRefiner() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [maxChars, setMaxChars] = useState(8000);
  const [text, setText] = useState(EXAMPLE);
  // A field people never see; bots that fill every input reveal themselves.
  const [website, setWebsite] = useState('');
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<{ original: string; text: string } | null>(null);
  const [busy, setBusy] = useState<'questions' | 'draft' | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);

  useEffect(() => {
    try {
      const handed = sessionStorage.getItem(refinerInputKey());
      sessionStorage.removeItem(refinerInputKey());
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only handoff from the prompt checker.
      if (handed) setText(handed);
    } catch { /* Storage unavailable: keep the example. */ }
  }, []);

  useEffect(() => {
    let active = true;
    ApiClient.getPublicRefineStatus().then((state) => {
      if (!active) return;
      setAvailable(state.available);
      setStatusFailed(false);
      if (state.max_chars) setMaxChars(state.max_chars);
    }).catch(() => { if (active) setStatusFailed(true); });
    return () => { active = false; };
  }, [statusAttempt]);

  const run = async <T,>(step: 'questions' | 'draft', work: () => Promise<T>, done: (value: T) => void) => {
    setBusy(step);
    setError('');
    setStatus('');
    try {
      done(await work());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Refinement failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const askQuestions = () => run('questions', () => ApiClient.getPublicRefineQuestions(text, website, questions !== null), ({ questions: found }) => {
    setQuestions(found);
    setAnswers(found.map(() => ''));
    setResult(null);
  });

  const createDraft = () => {
    const original = text;
    const pairs = (questions ?? []).map((question, i) => ({ question, answer: answers[i] ?? '' })).filter((pair) => pair.answer.trim());
    void run('draft', () => ApiClient.createPublicRefineDraft(original, website, pairs), ({ text: refined }) => setResult({ original, text: refined }));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result!.text);
      setStatus('Refined prompt copied.');
    } catch {
      setStatus('Copying failed. Select the text and copy it.');
    }
  };

  if (available === false) {
    return (
      <p className={styles.status} role="status">
        The free refiner is not offered on this server. Sign in and connect your own AI provider to
        refine prompts in the editor.
      </p>
    );
  }

  // Showing the form before the answer would flash controls a server may not offer.
  if (available === null && !statusFailed) {
    return <p className={styles.status} role="status">Checking whether the free refiner is available…</p>;
  }

  const tooLong = text.length > maxChars;
  const statusNotice = statusFailed && (
    <p className={styles.error} role="alert">
      Could not check whether free refinement is available.{' '}
      <Button variant="ghost" onClick={() => { setStatusFailed(false); setStatusAttempt((n) => n + 1); }}>Try again</Button>
    </p>
  );
  return (
    <>
      <div className={styles.field}>
        <label htmlFor="refiner-prompt">Your prompt</label>
        <textarea id="refiner-prompt" className={styles.textarea} value={text} disabled={busy !== null} aria-describedby="refiner-prompt-limit"
          onChange={(event) => { setText(event.target.value); setQuestions(null); setResult(null); }} />
        <small id="refiner-prompt-limit">{tooLong ? `Shorten it to ${maxChars.toLocaleString('en')} characters.` : `Up to ${maxChars.toLocaleString('en')} characters.`}</small>
      </div>
      {statusNotice}
      <label className={styles.honeypot} aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
      </label>

      {questions && questions.length > 0 && (
        <fieldset className={`${styles.field} ${styles.fieldset}`}>
          <legend>Answer what matters; leave the rest blank</legend>
          {questions.map((question, i) => (
            <label key={question} className={styles.field}>
              {question}
              <textarea className={`${styles.textarea} ${styles.short}`} value={answers[i] ?? ''} maxLength={2000} disabled={busy !== null}
                onChange={(event) => setAnswers(answers.map((answer, j) => (j === i ? event.target.value : answer)))} />
            </label>
          ))}
        </fieldset>
      )}
      {questions && questions.length === 0 && <p className={styles.status}>No important gaps found. You can still improve the wording.</p>}

      <div className={styles.actions}>
        <Button variant="primary" onClick={createDraft} disabled={busy !== null || !text.trim() || tooLong || available === null}>
          {busy === 'draft' ? 'Refining…' : questions?.length ? 'Refine with my answers' : 'Improve now'}
        </Button>
        <Button onClick={askQuestions} disabled={busy !== null || !text.trim() || tooLong || available === null}>
          {busy === 'questions' ? 'Finding questions…' : questions ? 'Ask more questions' : 'Ask me questions first'}
        </Button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}

      {result && (
        <section className={styles.field} aria-label="Refined prompt">
          <p className={styles.legend}><ins>Added</ins> and <del>removed</del> words.</p>
          <div className={styles.diff} tabIndex={0} aria-label="Changes from your prompt">
            {diffWords(result.original, result.text).map((token, i) =>
              token.type === 'added' ? <ins key={i}>{token.text}</ins>
                : token.type === 'removed' ? <del key={i}>{token.text}</del>
                  : <span key={i}>{token.text}</span>,
            )}
          </div>
          <div className={styles.actions}>
            <Button variant="primary" onClick={copy}>Copy refined prompt</Button>
            <Button onClick={() => openInApp({ fields: [{ name: 'Task', content: result.text }] })}>Save to my library</Button>
            <Button variant="ghost" onClick={() => { setText(result.text); setResult(null); setQuestions(null); }}>Keep refining</Button>
            <span role="status" className={styles.status}>{status}</span>
          </div>
        </section>
      )}
    </>
  );
}
