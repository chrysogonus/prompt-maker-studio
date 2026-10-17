'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { variablesIn } from '@/lib/sections';
import type { PromptHistoryResponse } from '@/types/prompt';
import type { EvalCaseInput, EvalMethod } from '@/types/evaluation';
import { METHOD_LABELS } from './useEvaluation';
import styles from './Evaluation.module.css';

interface Props {
  prompt: PromptHistoryResponse;
  initial?: EvalCaseInput;
  isEditing: boolean;
  busy: boolean;
  error: string;
  onSave: (input: EvalCaseInput) => Promise<void>;
  onCancel: () => void;
}

export default function CaseForm({ prompt, initial, isEditing, busy, error, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [method, setMethod] = useState<EvalMethod>(initial?.method ?? 'rule');
  const [criteria, setCriteria] = useState(initial?.criteria ?? '');
  const [advanced, setAdvanced] = useState(Boolean(initial));
  const [checks, setChecks] = useState([{ kind: 'contains', text: '' }]);
  const guidedCriteria = checks.map(({ kind, text }) => kind === 'json' ? '{json}' : `${kind === 'excludes' ? '!' : ''}${text.trim()}`).join(', ');
  const invalidCheck = checks.some(({ kind, text }) => kind !== 'json' && (!text.trim() || /[,()[\]{}\\]/.test(text) || /^[!~]/.test(text.trim())));
  const savedCriteria = method === 'rule' && !advanced ? guidedCriteria : criteria;
  const updateCheck = (index: number, value: Partial<{ kind: string; text: string }>) => setChecks(checks.map((check, position) => position === index ? { ...check, ...value } : check));
  const [variables, setVariables] = useState(initial?.variables ?? {});
  const [intentionallyEmpty, setIntentionallyEmpty] = useState(initial?.intentionally_empty ?? false);
  const promptVariables = variablesIn(prompt.fields);
  const names = [...new Set([...promptVariables, ...Object.keys(variables)])];
  const missing = promptVariables.filter((key) => typeof variables[key] !== 'string' || !variables[key].trim());

  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      void onSave({ name: name.trim(), method, criteria: method === 'manual' ? '' : savedCriteria === initial?.criteria ? savedCriteria : savedCriteria.trim(), variables, intentionally_empty: intentionallyEmpty });
    }}>
      <h2>{isEditing ? 'Edit test case' : 'New test case'}</h2>
      <p className={styles.hint}>One example of how you use this prompt, and how to judge its output.</p>
      <fieldset disabled={busy}>
        <label className={styles.field}>
          <span>Name <span className={styles.hint}>(optional)</span></span>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus placeholder="e.g. A short release summary" />
        </label>
        {names.length > 0 && (
          <section className={styles.formSection} aria-labelledby="case-inputs">
            <h3 id="case-inputs">Inputs</h3>
            <p className={styles.hint}>These values replace the variables in your saved prompt.</p>
            {names.map((key) => (
              <label className={styles.field} key={key}>
                <span>{key}{!promptVariables.includes(key) && <span className={styles.hint}> (no longer in this prompt)</span>}</span>
                <textarea value={typeof variables[key] === 'string' ? variables[key] : ''} onChange={(event) => setVariables({ ...variables, [key]: event.target.value })}
                  placeholder={prompt.variable_metadata?.[key]?.description ?? 'Value for this example'} rows={2} maxLength={10_000}
                  required={promptVariables.includes(key) && !intentionallyEmpty} />
              </label>
            ))}
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={intentionallyEmpty} onChange={(event) => setIntentionallyEmpty(event.target.checked)} />
              This case intentionally leaves inputs blank
            </label>
            {(intentionallyEmpty || missing.length > 0) && <p className={styles.hint}>Blank inputs leave their {'{{placeholders}}'} in the text sent to the model.</p>}
          </section>
        )}
        <section className={styles.formSection} aria-labelledby="case-scoring">
          <h3 id="case-scoring">What makes a good output?</h3>
          <div className={styles.field}>
            <label htmlFor="evaluation-method">Scoring</label>
            <Select id="evaluation-method" value={method} onChange={(event) => setMethod(event.target.value as EvalMethod)}>
              {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          {method === 'manual' ? (
            <p className={styles.hint}>Read the output after running, then rate it from 1 to 5. The model still runs using your AI connection.</p>
          ) : (
            <>
              {method === 'rule' && !advanced ? <>
                {checks.map((check, index) => <div key={index}>
                  <label className={styles.field}><span>Check {index + 1}</span>
                    <Select value={check.kind} onChange={(event) => updateCheck(index, { kind: event.target.value })}>
                      <option value="contains">Contains</option><option value="excludes">Does not contain</option><option value="json">Valid JSON</option>
                    </Select>
                  </label>
                  {check.kind !== 'json' && <label className={styles.field}><span>Text for check {index + 1}</span>
                    <Input value={check.text} onChange={(event) => updateCheck(index, { text: event.target.value })} required maxLength={2000} placeholder="e.g. summary" />
                  </label>}
                  {checks.length > 1 && <Button onClick={() => setChecks(checks.filter((_, position) => position !== index))}>Remove check {index + 1}</Button>}
                </div>)}
                <Button onClick={() => setChecks([...checks, { kind: 'contains', text: '' }])}>Add check</Button>
                <p className={styles.hint}>Text checks ignore case. Each check has equal weight. Use advanced checks for commas, brackets, backslashes, or text starting with ! or ~.</p>
                <Button onClick={() => { setCriteria(guidedCriteria); setAdvanced(true); }}>Use advanced checks</Button>
              </> : <label className={styles.field}>
                <span>{method === 'rule' ? 'Checks' : 'Review instructions'}</span>
                <textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} required maxLength={2000} rows={3}
                  aria-describedby="scoring-help" placeholder={method === 'rule' ? '{json}' : 'e.g. Is the summary accurate, concise and easy to scan?'} />
              </label>}
              <p id="scoring-help" className={styles.hint}>
                {method === 'rule' ? (advanced ? 'Each check has equal weight. Separate checks with commas.' : 'Choose a check type and add the text you expect.') : 'Your connected model reviews the output against these instructions. This adds a second AI call for this case.'}
              </p>
              {method === 'rule' && advanced && (
                <details className={styles.help}>
                  <summary>How to write checks</summary>
                  <dl className={styles.syntax}>
                    <dt><code>summary</code></dt><dd>Must contain this text (ignores case)</dd>
                    <dt><code>!sorry</code></dt><dd>Must not contain this text</dd>
                    <dt><code>{'{json}'}</code></dt><dd>Must be valid JSON</dd>
                    <dt><code>~pattern</code></dt><dd>Must match this regular expression</dd>
                  </dl>
                  <p>For example: <code>summary, !sorry</code>. Commas inside brackets are kept together.</p>
                </details>
              )}
            </>
          )}
        </section>
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || (method !== 'manual' && (!savedCriteria.trim() || savedCriteria.length > 2000 || (method === 'rule' && !advanced && invalidCheck))) || (!intentionallyEmpty && missing.length > 0)}>{busy ? 'Saving…' : 'Save test case'}</Button>
      </div>
    </form>
  );
}
