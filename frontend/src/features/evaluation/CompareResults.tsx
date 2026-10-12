import type { EvalResult, EvalRun } from '@/types/evaluation';
import { JudgeFeedback } from './RunResults';
import { METHOD_LABELS } from './useEvaluation';
import styles from './Evaluation.module.css';

function ComparisonOutput({ result, title }: { result?: EvalResult; title: string }) {
  return <div className={styles.comparisonOutput}>
    <h4>{title}</h4>
    {result ? <>
      <p className={styles.hint}>{METHOD_LABELS[result.method]}: {result.is_pending ? 'Needs your rating' : result.score === null ? 'Not scored' : `${Math.round(result.score)}/100`}</p>
      <pre className={styles.compareText}>{result.output_text === null ? 'No model output recorded.' : result.output_text || '(Empty output)'}</pre>
      {result.rationale && <JudgeFeedback rationale={result.rationale} />}
      <details className={styles.runDetails}><summary>Inputs and scoring</summary>
        <dl className={styles.metadata}>{Object.entries(result.variables ?? {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd className={styles.verbatim}>{value || '(Blank; placeholder kept)'}</dd></div>)}</dl>
        {result.criteria && <p className={styles.verbatim}>{result.criteria}</p>}
      </details>
    </> : <p className={styles.hint}>Not included in this run.</p>}
  </div>;
}

export default function CompareResults({ selected, compared }: { selected: EvalRun; compared: EvalRun }) {
  const rows: { selected?: EvalResult; compared?: EvalResult }[] = selected.results.map((result) => ({
    selected: result,
    compared: result.eval_case_id === null ? undefined : compared.results.find((item) => item.eval_case_id === result.eval_case_id),
  }));
  for (const result of compared.results) {
    if (!rows.some((row) => row.compared?.id === result.id)) rows.push({ compared: result });
  }
  const selectedTitle = `Selected run / version ${selected.prompt_version_number}`;
  const comparedTitle = `Compared run / version ${compared.prompt_version_number}`;
  return <section aria-label="Run comparison">
    <h2>Compare outputs</h2>
    <p className={styles.hint}>Cases are matched by their saved identity. Deleted cases are shown separately. Return to a single run to add manual ratings.</p>
    {selected.model !== compared.model && <p className={styles.banner}>These runs used different models. Their scores may not be directly comparable.</p>}
    <div className={styles.comparisonColumns}>
      {[{ run: selected, title: selectedTitle }, { run: compared, title: comparedTitle }].map(({ run, title }) => (
        <div key={title}><h3>{title}</h3><p>{run.score === null ? 'Not scored yet' : `${Math.round(run.score)}/100`}</p><p className={styles.hint}>{run.model || 'Model not recorded'}</p></div>
      ))}
    </div>
    {rows.map((row) => {
      const left = row.selected;
      const right = row.compared;
      const changed = left && right && (left.method !== right.method || left.criteria !== right.criteria ||
        Object.keys(left.variables ?? {}).length !== Object.keys(right.variables ?? {}).length ||
        Object.entries(left.variables ?? {}).some(([name, value]) => !Object.hasOwn(right.variables ?? {}, name) || right.variables?.[name] !== value));
      return <article key={`${left?.id ?? ''}:${right?.id ?? ''}`} className={styles.result}>
        <h3>{left?.label || right?.label || 'Test case'}</h3>
        {changed && <p className={styles.banner}>Inputs or scoring changed. These scores measure different conditions.</p>}
        <div className={styles.comparisonColumns}>
          <ComparisonOutput result={left} title={selectedTitle} />
          <ComparisonOutput result={right} title={comparedTitle} />
        </div>
      </article>;
    })}
  </section>;
}
