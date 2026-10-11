'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClient, ApiError, isValidPromptId, PROMPT_NOT_FOUND_MESSAGE } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { pageTitle } from '@/lib/branding';
import type { PromptHistoryResponse, PromptsConfigResponse } from '@/types/prompt';
import type { EvalCase, EvalCaseInput, EvalProposal, EvalRun } from '@/types/evaluation';

export const METHOD_LABELS = { rule: 'Automatic checks', judge: 'AI review', manual: 'Manual review' };
export const CASE_LIMIT = 20;

type Editing = { caseId?: number; initial?: EvalCaseInput; proposalIndex?: number };

export function useEvaluation(promptId: number) {
  const [prompt, setPrompt] = useState<PromptHistoryResponse | null>(null);
  const [config, setConfig] = useState<PromptsConfigResponse | null>(null);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const actionPending = useRef(false);
  const [view, setView] = useState<'cases' | 'runs'>('cases');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<EvalCase | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [proposals, setProposals] = useState<EvalProposal[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    if (!isValidPromptId(promptId)) {
      setLoadError(PROMPT_NOT_FOUND_MESSAGE);
      setLoading(false);
      return;
    }
    Promise.all([
      ApiClient.getPromptById(promptId), ApiClient.getEvalCases(promptId),
      ApiClient.getEvalRuns(promptId), ApiClient.getPromptsConfig(),
    ]).then(([loaded, testCases, history, capability]) => {
      if (!active) return;
      setPrompt(loaded);
      setCases(testCases);
      setRuns(history);
      setConfig(capability);
    }).catch((failure) => {
      if (active) setLoadError(failure instanceof ApiError && failure.status === 404
        ? PROMPT_NOT_FOUND_MESSAGE : failure instanceof Error ? failure.message : 'Could not load evaluation.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [promptId, loadAttempt]);

  useEffect(() => {
    document.title = pageTitle(prompt ? `Evaluate ${prompt.name ?? 'prompt'}` : 'Evaluate');
    return () => { document.title = pageTitle(); };
  }, [prompt]);

  async function perform(action: string, work: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The request failed. Please try again.');
    } finally {
      actionPending.current = false;
      setBusy('');
    }
  }

  async function saveCase(input: EvalCaseInput) {
    await perform('save', async () => {
      const saved = editing?.caseId !== undefined
        ? await ApiClient.updateEvalCase(promptId, editing.caseId, input)
        : await ApiClient.createEvalCase(promptId, input);
      setCases((current) => editing?.caseId !== undefined
        ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      if (editing?.proposalIndex !== undefined) {
        setProposals((current) => current.filter((_, index) => index !== editing.proposalIndex));
      }
      setEditing(null);
      setNotice('Test case saved.');
    });
  }

  async function deleteCase() {
    if (!deleting) return;
    await perform('delete', async () => {
      await ApiClient.deleteEvalCase(promptId, deleting.id);
      setCases((current) => current.filter((item) => item.id !== deleting.id));
      setDeleting(null);
      setNotice('Test case deleted. Past evaluation results are kept.');
    });
  }

  async function generate(goal: string) {
    await perform('generate', async () => {
      const { proposals: suggestions } = await ApiClient.generateEvalCases(promptId, goal);
      setProposals(suggestions);
      setSuggesting(false);
      setNotice(suggestions.length ? 'Suggestions are ready to review. Nothing has been saved.' : 'No suggestions returned. Try a different testing focus.');
    });
  }

  async function run() {
    await perform('run', async () => {
      const result = await ApiClient.runEvaluation(promptId);
      setRuns((current) => [result, ...current]);
      setSelectedRunId(result.id);
      setView('runs');
      setNotice('Evaluation finished.');
    });
  }

  async function rate(runId: number, resultId: number, stars: number) {
    await perform(`rate:${resultId}`, async () => {
      const updated = await ApiClient.rateEvalResult(promptId, runId, resultId, stars);
      setRuns((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice('Rating saved.');
    });
  }

  async function importCsv(csv: string, close: () => void) {
    await perform('import', async () => {
      const imported = await ApiClient.importEvalCases(promptId, csv);
      setCases((current) => [...current, ...imported]);
      close();
      setNotice(`${imported.length} test ${imported.length === 1 ? 'case' : 'cases'} imported.`);
    });
  }

  async function exportCsv() {
    await perform('export', async () => {
      downloadBlob(await ApiClient.exportEvalCases(promptId), `prompt-${promptId}-test-cases.csv`);
      setNotice('Test cases exported.');
    });
  }

  return {
    prompt, config, cases, runs, loading, loadError, retry: () => setLoadAttempt((n) => n + 1),
    error, setError, notice, busy, view, setView, editing, setEditing, deleting, setDeleting,
    suggesting, setSuggesting, proposals, setProposals, selectedRunId, setSelectedRunId,
    saveCase, deleteCase, generate, run, rate, importCsv, exportCsv,
  };
}
