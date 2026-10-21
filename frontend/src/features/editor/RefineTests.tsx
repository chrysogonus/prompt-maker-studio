'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import CompareResults from '@/features/evaluation/CompareResults';
import { ApiClient } from '@/lib/api';
import { judgeAgreement, runVersionLabel } from '@/lib/evaluationStatus';
import { renderSections } from '@/lib/sections';
import type { EvalResult, EvalRun } from '@/types/evaluation';
import type { PromptField } from '@/types/prompt';
import styles from './RefinePanel.module.css';

export const MAX_EVIDENCE = 5;

/** Scored results with an output, weakest first: the ones worth improving on. */
export function evidenceCandidates(run: EvalRun | undefined): EvalResult[] {
  return (run?.results ?? [])
    .filter((result) => result.score !== null && result.output_text !== null)
    .sort((a, b) => a.score! - b.score!);
}

/** The run whose results describe these sections: the latest that tested this exact text,
 * otherwise the latest of a saved version — never a check of some other unsaved draft. */
export function evidenceRun(runs: EvalRun[], fields: PromptField[]): EvalRun | undefined {
  const text = renderSections(fields);
  return runs.find((run) => run.tested_prompt === text) ?? runs.find((run) => run.tested_version !== null);
}

export function TestResultPicker({ run, chosen, disabled, onChange }: {
  run: EvalRun;
  chosen: number[];
  disabled: boolean;
  onChange: (chosen: number[]) => void;
}) {
  return (
    <fieldset className={styles.tests}>
      <legend>Improve using test results (optional)</legend>
      <p className={styles.hint}>
        From your latest evaluation ({runVersionLabel(run).toLowerCase()}). The inputs, outputs and feedback
        you choose are sent to AI with your prompt. Choose up to {MAX_EVIDENCE}.
      </p>
      {evidenceCandidates(run).map((result) => {
        const checked = chosen.includes(result.id);
        return (
          <label key={result.id} className={styles.testOption}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || (!checked && chosen.length >= MAX_EVIDENCE)}
              onChange={() => onChange(checked ? chosen.filter((id) => id !== result.id) : [...chosen, result.id])}
            />
            <span>{result.label || 'Test case'} · {Math.round(result.score!)}/100</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Runs the saved test cases on the draft, and on the current sections unless a run already tested that text. */
export function DraftCheck({ promptId, caseCount, runs, source, draft, disabled }: {
  promptId: number;
  caseCount: number;
  runs: EvalRun[];
  source: PromptField[];
  draft: PromptField[];
  disabled: boolean;
}) {
  const [result, setResult] = useState<{ draft: EvalRun; current: EvalRun } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sourceText = renderSections(source);
  const existing = runs.find((run) => run.tested_prompt === sourceText);

  const check = async () => {
    setBusy(true);
    setError('');
    try {
      const [draftRun, current] = await Promise.all([
        ApiClient.runEvaluation(promptId, draft),
        existing ?? ApiClient.runEvaluation(promptId, source),
      ]);
      setResult({ draft: draftRun, current });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run your test cases. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const agreement = judgeAgreement(runs);
    const judged = result.draft.results.some((item) => item.method === 'judge');
    return (
      <section className={`${styles.section} ${styles.checked}`} aria-label="Test results for this draft">
        <p className={styles.hint}>
          Each case ran once, so small score differences can be chance.
          {judged && (agreement.rated
            ? ` AI review agreed with your own rating on ${agreement.agreed} of ${agreement.rated} rated outputs.`
            : ' AI review scores have not been checked against your own ratings yet; rate some in Evaluate.')}
        </p>
        <CompareResults selected={result.draft} compared={result.current} titles={['This draft', 'Your current prompt']} />
      </section>
    );
  }
  return (
    <section className={styles.section} aria-label="Check against test cases">
      <h3>Check against your test cases</h3>
      <p className={styles.hint}>
        Runs your {caseCount} test {caseCount === 1 ? 'case' : 'cases'} on this draft
        {existing ? '' : ' and on your current prompt'} with your AI connection. Nothing is saved to the prompt;
        the runs appear in its Run history.
      </p>
      <Button variant="secondary" disabled={busy || disabled} onClick={() => void check()}>
        {busy ? 'Running test cases…' : 'Check against test cases'}
      </Button>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
