'use client';

import Link from 'next/link';
import { resultFailure, resultStatus, runScoreLabel } from '@/lib/evaluationStatus';
import type { EvalResult } from '@/types/evaluation';
import Button from '@/components/ui/Button';
import type { EvalRun } from '@/types/evaluation';
import { METHOD_LABELS } from './useEvaluation';
import styles from './Evaluation.module.css';

export function JudgeFeedback({ rationale }: { rationale: string }) {
  let feedback: { text?: string; strengths?: string[]; weaknesses?: string[] } | null = null;
  try { feedback = JSON.parse(rationale); } catch { /* Older runs store plain text. */ }
  if (!feedback || typeof feedback !== 'object' || typeof feedback.text !== 'string') return <p className={styles.feedback}>{rationale}</p>;
  return <div className={styles.feedback}>
    <p>{feedback.text}</p>
    {(['strengths', 'weaknesses'] as const).map((key) => Array.isArray(feedback[key]) && feedback[key]!.length > 0 ? (
      <div key={key}>
        <h4>{key === 'strengths' ? 'What worked' : 'What to improve'}</h4>
        <ul>{feedback[key]!.filter((item) => typeof item === 'string').map((item, index) => <li key={index}>{item}</li>)}</ul>
      </div>
    ) : null)}
  </div>;
}

export function ResultFeedback({ result }: { result: EvalResult }) {
  const failure = resultFailure(result);
  if (!failure) return result.rationale ? <JudgeFeedback rationale={result.rationale} /> : null;
  // Old history can contain raw provider exceptions. Never display that payload.
  let message = 'Check your AI connection in Settings, then run the evaluation again.';
  const prefix = failure === 'generation' ? 'Model run failed: ' : 'Judge grading failed: ';
  if (result.rationale?.startsWith(prefix)) {
    try {
      const parsed = JSON.parse(result.rationale.slice(prefix.length));
      if (typeof parsed.message === 'string') message = parsed.message;
    } catch { /* Legacy exception text is deliberately hidden. */ }
  }
  return <div className={styles.feedback}>
    <p className={styles.error}>{failure === 'generation' ? 'The model could not generate output.' : 'The output was generated, but AI scoring failed.'}</p>
    <p>{message} <Link href="/settings">Open Settings</Link></p>
    <details className={styles.runDetails}><summary>Technical diagnostics</summary>
      <p>Failed stage: {failure === 'generation' ? 'output generation' : 'AI scoring'}. Provider request data and raw exception details are hidden.</p>
    </details>
  </div>;
}

export default function RunResults({ run, busy, onRate }: {
  run: EvalRun;
  busy: string;
  onRate: (runId: number, resultId: number, stars: number) => Promise<void>;
}) {
  const pending = run.results.filter((result) => result.is_pending).length;
  return (
    <section className={styles.results} aria-label="Evaluation results">
      <div className={styles.runSummary}>
        <div>
          <h2>{runScoreLabel(run)}</h2>
          <p className={styles.hint}>{pending ? `${pending} ${pending === 1 ? 'result needs' : 'results need'} your rating. The overall score appears after all ratings are saved.` : 'Average of scored results. Failed and unscored results are excluded.'}</p>
        </div>
        <span className={styles.hint}>Saved prompt version {run.prompt_version_number}</span>
      </div>
      <details className={styles.runDetails}>
        <summary>Run details</summary>
        <dl className={styles.metadata}>
          <dt>Model</dt><dd>{run.model || 'Not recorded'}</dd>
          <dt>Total model time</dt><dd>{(run.total_latency_ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} seconds across all calls. Calls can run at the same time.</dd>
          <dt>Tokens</dt><dd>{run.total_prompt_tokens.toLocaleString()} input, {run.total_completion_tokens.toLocaleString()} output</dd>
          <dt>Estimated cost</dt><dd>${run.total_cost_usd.toFixed(4)}</dd>
        </dl>
      </details>
      {run.results.map((result, index) => (
        <article key={result.id} className={styles.result}>
          <header className={styles.resultHead}>
            <div><h3>{result.label || `Test case ${index + 1}`}</h3><p className={styles.hint}>{METHOD_LABELS[result.method]}</p></div>
            <span className={styles.resultScore}>
              {`${resultStatus(result)}${result.score === null ? '' : ` · ${Math.round(result.score)}/100`}`}
            </span>
          </header>
          {result.output_text !== null ? <div className={styles.output}><h4>Model output</h4><pre>{result.output_text || '(Empty output)'}</pre></div>
            : <p className={styles.error}>No model output was recorded for this case.</p>}
          <ResultFeedback result={result} />
          {result.is_pending && (
            <div className={styles.rating}>
              <p>How well did this output meet your expectations?</p>
              <div role="group" aria-label={`Rate ${result.label || `test case ${index + 1}`}`} className={styles.ratingButtons}>
                {[1, 2, 3, 4, 5].map((stars) => <Button key={stars} disabled={!!busy}
                  aria-label={`Rate ${stars} out of 5`} onClick={() => void onRate(run.id, result.id, stars)}>{stars}</Button>)}
              </div>
              <p className={styles.hint}>{busy === `rate:${result.id}` ? 'Saving rating…' : '1 = poor, 5 = excellent. A rating is final once saved.'}</p>
            </div>
          )}
          <details className={styles.runDetails}>
            <summary>Inputs and scoring used for this result</summary>
            {result.variables && Object.keys(result.variables).length > 0 ? (
              <dl className={styles.metadata}>{Object.entries(result.variables).map(([name, value]) => <div key={name}><dt>{name}</dt><dd className={styles.verbatim}>{value || '(Blank; placeholder kept)'}</dd></div>)}</dl>
            ) : <p className={styles.hint}>No variable values were recorded.</p>}
            {result.criteria && <p className={styles.verbatim}>{result.criteria}</p>}
            {result.judge_model && <p className={styles.hint}>Reviewed by {result.judge_model}</p>}
          </details>
        </article>
      ))}
    </section>
  );
}
