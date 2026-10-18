'use client';

import { useState } from 'react';
import Link from 'next/link';
import { budgetStatusText } from '@/components/ui/AICallContext';
import Button, { ButtonLink } from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { PROMPT_NOT_FOUND_MESSAGE } from '@/lib/api';
import { runScoreLabel } from '@/lib/evaluationStatus';
import { parseServerDate } from '@/lib/relativeTime';
import { variablesIn } from '@/lib/sections';
import CaseForm from './CaseForm';
import RunResults from './RunResults';
import CompareResults from './CompareResults';
import { CASE_LIMIT, METHOD_LABELS, useEvaluation } from './useEvaluation';
import styles from './Evaluation.module.css';

const VIEWS = [{ value: 'cases', label: 'Test cases' }, { value: 'runs', label: 'Run history' }] as const;
const runDate = (date: string) => parseServerDate(date).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

export default function EvaluationPage({ promptId }: { promptId: number }) {
  const evaluation = useEvaluation(promptId);
  const {
    prompt, currentVersion, config, configError, configChecking, budgetRejection, retryConfig, cases, runs, hasMoreRuns, loadOlderRuns, loading, loadError, retry, error, setError, aiError, notice, busy,
    view, setView, editing, setEditing, deleting, setDeleting, suggesting, setSuggesting,
    proposals, setProposals, selectedRunId, setSelectedRunId,
    saveCase, deleteCase, generate, run, rate, importCsv, exportCsv,
  } = evaluation;
  const [goal, setGoal] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [comparisonId, setComparisonId] = useState('');

  if (loading) return <p className={styles.loading} role="status">Loading evaluation…</p>;
  if (loadError || !prompt) return (
    <div className={styles.empty} role="alert">
      <h1>{loadError === PROMPT_NOT_FOUND_MESSAGE ? 'Prompt not found' : 'Could not load evaluation'}</h1>
      <p>{loadError}</p>
      <div className={styles.actions}>
        <ButtonLink href="/library">Back to library</ButtonLink>
        {loadError !== PROMPT_NOT_FOUND_MESSAGE && <Button onClick={retry}>Try again</Button>}
      </div>
    </div>
  );

  const atLimit = cases.length >= CASE_LIMIT;
  const canUseAI = Boolean(config?.provider_connected && !config.budget_exhausted && !budgetRejection);
  const variables = variablesIn(prompt.fields);
  const incomplete = cases.filter((item) => !item.intentionally_empty && variables.some((name) => typeof item.variables[name] !== 'string' || !item.variables[name].trim()));
  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? runs[0];
  const comparedRun = runs.find((item) => String(item.id) === comparisonId && item.id !== selectedRun?.id);
  const closeImport = () => { setImportOpen(false); setError(''); };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} href={`/editor/${promptId}`}>Back to editor</Link>
          <h1>Evaluate</h1>
          <p className={styles.promptName}>{prompt.name ?? 'Untitled prompt'}</p>
        </div>
        <div className={styles.runAction}>
          <Button variant="primary" onClick={() => void run()} disabled={!!busy || !!editing || suggesting || !canUseAI || !cases.length || incomplete.length > 0}>
            {busy === 'run' ? 'Running evaluation…' : 'Run evaluation'}
          </Button>
          <p className={styles.hint}>Runs {cases.length ? `all ${cases.length} ${cases.length === 1 ? 'case' : 'cases'}` : 'your cases'} on the latest saved prompt.</p>
        </div>
      </header>

      {configChecking ? (
        <p className={styles.banner} role="status">Checking AI availability…</p>
      ) : configError ? (
        <div className={styles.banner} role="alert">{configError} <Button onClick={retryConfig}>Retry AI availability</Button></div>
      ) : config?.budget_exhausted || budgetRejection ? (
        <div className={styles.banner}>
          <p>{budgetRejection?.budget
            ? budgetStatusText(budgetRejection.budget.scope, budgetRejection.budget.resets_at, budgetRejection.budget.reason === 'estimated_cost_exceeds_remaining')
            : config?.budget_exhausted ? budgetStatusText(config.budget_scope, config.budget_resets_at)
              : 'This request was blocked by the monthly API budget.'} You can still manage cases and review past results.</p>
          <Link href="/settings#s-api">Review AI settings</Link>{' '}
          <Button onClick={retryConfig}>Recheck AI availability</Button>
        </div>
      ) : config?.provider_connected ? (
        <p className={styles.connection}>Uses {config.provider_label ?? 'your AI connection'}{config.model ? ` / ${config.model}` : ''}. Runs and suggestions may incur provider charges.</p>
      ) : (
        <p className={styles.banner}><Link href="/settings#s-api">Connect an AI provider</Link> to run evaluations or suggest cases. You can create cases and read past results now.</p>
      )}
      {busy === 'run' && <p className={styles.banner} role="status">Running your saved prompt against each case. Keep this page open until the results arrive.</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && !editing && !importOpen && !deleting && <p className={styles.error} role="alert">{error}{aiError && <> <Link href="/settings">Open Settings</Link></>}</p>}

      <fieldset disabled={!!editing || !!busy || suggesting} className={styles.viewSwitch}>
        <SegmentedControl aria-label="Evaluation view" options={VIEWS} value={view} onChange={setView} />
      </fieldset>

      {view === 'cases' ? editing ? (
        <CaseForm key={editing.caseId ?? `new:${editing.proposalIndex ?? ''}`} prompt={prompt} initial={editing.initial}
          isEditing={editing.caseId !== undefined} busy={!!busy} error={error} onSave={saveCase}
          onCancel={() => { setEditing(null); setError(''); }} />
      ) : (
        <>
          <div className={styles.toolbar}>
            <p className={styles.hint}>{cases.length} of {CASE_LIMIT} test cases</p>
            <div className={styles.actions}>
              <Button variant="ghost" disabled={!!busy || suggesting} onClick={() => { setImportOpen(true); setCsv(''); setFilename(''); setError(''); }}>Import CSV</Button>
              <Button variant="ghost" disabled={!!busy || !cases.length} onClick={() => void exportCsv()}>Export CSV</Button>
              <Button disabled={!!busy || atLimit || !canUseAI || suggesting || proposals.length > 0} onClick={() => { setSuggesting(true); setError(''); }}>Suggest test cases</Button>
              <Button disabled={!!busy || atLimit || suggesting} onClick={() => { setEditing({}); setError(''); }}>Add test case</Button>
            </div>
          </div>
          {atLimit && <p className={styles.hint}>You have reached the {CASE_LIMIT}-case limit. Edit or remove a case to make room.</p>}
          {incomplete.length > 0 && <p className={styles.banner}>Fill in the missing inputs in {incomplete.length} {incomplete.length === 1 ? 'case' : 'cases'}, or mark them as intentionally blank, before running.</p>}
          {suggesting && (
            <form className={styles.suggestionsForm} onSubmit={(event) => { event.preventDefault(); void generate(goal); }}>
              <h2>Suggest test cases</h2>
              <p className={styles.hint}>AI proposes examples from your saved prompt. Review and edit each one before adding it.</p>
              <label className={styles.field}><span>Testing focus (optional)</span>
                <Input value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500} autoFocus disabled={!!busy} placeholder="e.g. Missing context or unexpected inputs" />
              </label>
              <div className={styles.actions}>
                <Button disabled={!!busy} onClick={() => setSuggesting(false)}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={!!busy || !canUseAI}>{busy === 'generate' ? 'Generating suggestions…' : 'Generate suggestions'}</Button>
              </div>
            </form>
          )}
          {proposals.length > 0 && (
            <section className={styles.suggestions} aria-labelledby="suggestion-heading">
              <div className={styles.toolbar}><div><h2 id="suggestion-heading">Suggested cases</h2><p className={styles.hint}>Not saved yet. Keep only the cases that are useful to you.</p></div>
                <Button variant="ghost" disabled={!!busy} onClick={() => setProposals([])}>Discard suggestions</Button>
              </div>
              {proposals.map((proposal, index) => (
                <article className={styles.caseRow} key={index}>
                  <div className={styles.caseText}><h3>{proposal.name || `Suggested case ${index + 1}`}</h3><p>{proposal.rationale}</p><p className={styles.hint}>{METHOD_LABELS[proposal.method]}</p></div>
                  <Button disabled={!!busy || atLimit} aria-label={`Review and add ${proposal.name || `suggested case ${index + 1}`}`} onClick={() => {
                    setError('');
                    setEditing({ proposalIndex: index, initial: { ...proposal, criteria: proposal.criteria ?? '', intentionally_empty: false } });
                  }}>Review and add</Button>
                </article>
              ))}
            </section>
          )}
          {!cases.length ? (
            <div className={styles.empty}>
              <h2>Try your prompt with a few examples.</h2>
              <p>Add inputs you actually use, then choose what a good output should look like. Run them together after you change the prompt.</p>
              <p className={styles.hint}>Start with one typical example. Add difficult cases as you find them.</p>
            </div>
          ) : (
            <section className={styles.caseList} aria-label="Saved test cases">
              {cases.map((item, index) => {
                const name = item.name || `Test case ${index + 1}`;
                return <article className={styles.caseRow} key={item.id}>
                  <div className={styles.caseText}>
                    <h3>{name}</h3>
                    <div className={styles.caseMeta}><span>{METHOD_LABELS[item.method]}</span><span>{Object.keys(item.variables).length} inputs</span>{item.intentionally_empty && <span>Blank inputs allowed</span>}</div>
                    {item.criteria && <p className={styles.criteria}>{item.criteria}</p>}
                  </div>
                  <div className={styles.actions}>
                    <Button variant="ghost" disabled={!!busy || suggesting} aria-label={`Edit ${name}`} onClick={() => {
                      setError('');
                      setEditing({ caseId: item.id, initial: { ...item, name: item.name ?? '', criteria: item.criteria ?? '' } });
                    }}>Edit</Button>
                    <Button variant="ghost" disabled={!!busy || suggesting} aria-label={`Delete ${name}`} onClick={() => { setDeleting(item); setError(''); }}>Delete</Button>
                  </div>
                </article>;
              })}
            </section>
          )}
        </>
      ) : !runs.length ? (
        <div className={styles.empty}><h2>No evaluations yet.</h2><p>Run your test cases to see model outputs, scores and feedback here.</p></div>
      ) : (
        <div className={styles.history}>
          <nav className={styles.runList} aria-label="Past evaluations">
            {runs.map((item) => <button type="button" key={item.id} aria-pressed={selectedRun.id === item.id}
              onClick={() => { setSelectedRunId(item.id); setComparisonId(''); }}>
              <time dateTime={parseServerDate(item.created_at).toISOString()}>{runDate(item.created_at)}</time>
              <span>Version {item.prompt_version_number}</span>
              <strong>{runScoreLabel(item)}</strong>
            </button>)}
            {hasMoreRuns && <Button variant="secondary" disabled={!!busy} onClick={() => void loadOlderRuns()}>
              {busy === 'history' ? 'Loading older evaluations…' : 'Load older evaluations'}
            </Button>}
          </nav>
          <div className={styles.results}>
            <p className={styles.banner}>Tested version {selectedRun.prompt_version_number}. Current saved version {currentVersion}.</p>
            {selectedRun.prompt_version_number !== currentVersion && <Button variant="secondary" onClick={() => void run()}
              disabled={!!busy || !canUseAI || !cases.length || incomplete.length > 0}>Run current version</Button>}
            {runs.length > 1 && <div className={styles.compareControl}>
              <label htmlFor="compare-run">Compare with</label>
              <Select id="compare-run" value={comparedRun ? comparisonId : ''} onChange={(event) => setComparisonId(event.target.value)}>
                <option value="">Don’t compare</option>
                {runs.filter((item) => item.id !== selectedRun.id).map((item) => <option key={item.id} value={item.id}>{runDate(item.created_at)} / version {item.prompt_version_number}</option>)}
              </Select>
            </div>}
            {comparedRun ? <CompareResults selected={selectedRun} compared={comparedRun} /> : <RunResults key={selectedRun.id} run={selectedRun} busy={busy} onRate={rate} />}
          </div>
        </div>
      )}

      <Dialog isOpen={!!deleting} title="Delete test case?" onClose={() => { if (!busy) setDeleting(null); }} actions={<>
        <Button disabled={!!busy} onClick={() => setDeleting(null)}>Cancel</Button>
        <Button variant="danger" disabled={!!busy} onClick={() => void deleteCase()}>{busy === 'delete' ? 'Deleting…' : 'Delete test case'}</Button>
      </>}>
        <p>Delete “{deleting?.name || 'this test case'}”? Past evaluation results are kept.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </Dialog>
      <Dialog isOpen={importOpen} title="Import test cases" onClose={() => { if (!busy && !readingFile) closeImport(); }} actions={<>
        <Button onClick={closeImport} disabled={!!busy || readingFile}>Cancel</Button>
        <Button variant="primary" disabled={!!busy || readingFile || !csv.trim()} onClick={() => void importCsv(csv, closeImport)}>{busy === 'import' ? 'Importing…' : 'Import test cases'}</Button>
      </>}>
        <div className={styles.importBody}>
          <p>Append cases to this prompt. Existing cases stay as they are.</p>
          <p>Use a UTF-8 CSV beginning with <code>method,criteria</code>. Methods are <code>rule</code>, <code>judge</code> or <code>manual</code>. Optional columns: <code>name</code>, <code>intentionally_empty</code>; other columns supply variable values.</p>
          <label className={styles.field}><span>CSV file</span><input type="file" accept=".csv,text/csv" disabled={!!busy || readingFile} onChange={async (event) => {
            const file = event.target.files?.[0];
            setCsv('');
            setFilename('');
            setError('');
            if (!file) return;
            setReadingFile(true);
            try { setCsv(await file.text()); setFilename(file.name); }
            catch { setError('Could not read this file. Choose it again.'); }
            finally { setReadingFile(false); }
          }} /></label>
          {readingFile && <p role="status">Reading file…</p>}
          {filename && <p>{filename}</p>}
          {csv && <pre className={styles.csvPreview}>{csv}</pre>}
          <p className={styles.hint}>Up to {CASE_LIMIT - cases.length} more cases. If a row is invalid, nothing is imported.</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
      </Dialog>
    </div>
  );
}
