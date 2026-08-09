/**
 * The Editor Detail "Evaluate" tab: an eval set of test cases (rule/judge/
 * manual scoring methods) that get compiled and run against a real model,
 * plus run history with per-case results and manual star ratings.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent } from 'react';
import Link from 'next/link';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import StarRating from '../ui/StarRating';
import PreflightPanel from '../ui/PreflightPanel';
import {
  ErrorStatusIcon,
  InfoStatusIcon,
  SuccessStatusIcon,
} from '../ui/icon';
import { ApiClient } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { extractPromptPlaceholders } from '@/lib/placeholders';
import { runPreflightChecks } from '@/lib/preflight';
import {
  EvalCase,
  EvalCaseProposal,
  EvalMethod,
  EvalRun,
  EvalRunResult,
  PromptHistoryResponse,
} from '@/types/prompt';
import { User } from '@/types/auth';
import styles from './EvaluateTab.module.css';

interface EvaluateTabProps {
  prompt: PromptHistoryResponse;
  currentUser: User | null;
}

interface ProposalItem extends EvalCaseProposal {
  clientId: string;
  status: 'active' | 'removing';
  intentionally_empty: boolean;
}

const FALLBACK_CASE_NAME_LENGTH = 60;

/**
 * Last-resort label when a proposal arrives without a name. Trims on a word
 * boundary — a mid-word slice of a rationale sentence is never an acceptable
 * case name, and it is what gets persisted if the user just accepts.
 */
function fallbackCaseName(rationale: string): string {
  const firstSentence = rationale.split(/(?<=[.!?])\s/, 1)[0]?.trim().replace(/\.$/, '') ?? '';
  const collapsed = firstSentence.split(/\s+/).join(' ');
  if (collapsed.length <= FALLBACK_CASE_NAME_LENGTH) return collapsed;
  const clipped = collapsed.slice(0, FALLBACK_CASE_NAME_LENGTH).replace(/\s+\S*$/, '');
  return (clipped || collapsed.slice(0, FALLBACK_CASE_NAME_LENGTH)).replace(/[ ,;:-]+$/, '');
}

const METHOD_DETAILS: Record<
  EvalMethod,
  {
    label: string;
    shortLabel: string;
    badge: string;
    title: string;
    description: string;
    bestFor: string;
  }
> = {
  rule: {
    label: 'Rule',
    shortLabel: 'Exact checks',
    badge: 'Deterministic',
    title: 'Exact checks, instant score',
    description:
      'Automatic checks, comma-separated: plain text must appear · !text must not appear · ' +
      '~pattern is a regex that must match · {json} requires valid JSON output. ' +
      'Commas inside (), [], {} stay within one check.',
    bestFor: 'Best for required wording, blocked terms, patterns, and valid JSON.',
  },
  judge: {
    label: 'Judge',
    shortLabel: 'AI review',
    badge: 'AI-scored',
    title: 'Grade nuanced quality with AI',
    description:
      'An AI judge grades the output 0–100 against this instruction, seeing the compiled prompt for context.',
    bestFor: 'Best for tone, relevance, clarity, and other qualities that need judgment.',
  },
  manual: {
    label: 'Manual',
    shortLabel: 'Your review',
    badge: 'Human-scored',
    title: 'Review the output yourself',
    description: 'Scored manually after each run — no auto-grading.',
    bestFor: 'Best for subjective review, spot checks, and criteria that are still evolving.',
  },
};

const MAX_EVAL_CASES = 20;
const CASE_SAVE_DEBOUNCE_MS = 300;
const PROPOSAL_REMOVE_DELAY_MS = 220;
const JUDGE_MODEL = 'gpt-4.1-mini-2025-04-14';

/** Results scoring below this get the "Debug in Playground" quick action —
 * near-perfect judge scores shouldn't flag every row. */
const DEBUG_SCORE_THRESHOLD = 70;

function criteriaPlaceholder(method: EvalMethod): string {
  if (method === 'rule') return 'e.g. refund, !sorry, ~\\d{2,3}, {json}';
  if (method === 'judge') return 'Grading instruction (e.g. "Be concise and on-topic")';
  return '';
}

function MethodIcon({ method }: { method: EvalMethod }) {
  if (method === 'rule') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="m8 12 2.5 2.5L16 9" />
      </svg>
    );
  }
  if (method === 'judge') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3c.5 4.9 3.1 7.5 8 8-4.9.5-7.5 3.1-8 8-.5-4.9-3.1-7.5-8-8 4.9-.5 7.5-3.1 8-8Z" />
        <path d="M19 3v4M21 5h-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
    </svg>
  );
}

function MethodPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: EvalMethod;
  onChange: (method: EvalMethod) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.methodPicker} role="radiogroup" aria-label={ariaLabel}>
      {(Object.keys(METHOD_DETAILS) as EvalMethod[]).map((method) => {
        const detail = METHOD_DETAILS[method];
        return (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={value === method}
            className={styles.methodOption}
            data-active={value === method}
            data-method={method}
            onClick={() => onChange(method)}
          >
            <span className={styles.methodOptionIcon}>
              <MethodIcon method={method} />
            </span>
            <span className={styles.methodOptionCopy}>
              <span className={styles.methodOptionLabel}>{detail.label}</span>
              <span className={styles.methodOptionShort}>{detail.shortLabel}</span>
            </span>
            <span className={styles.methodOptionCheck} aria-hidden="true">
              ✓
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MethodExplainer({ method }: { method: EvalMethod }) {
  const detail = METHOD_DETAILS[method];
  return (
    <div
      className={styles.methodExplainer}
      data-method={method}
      role="note"
      aria-label={`${detail.label} scoring description`}
    >
      <span className={styles.methodExplainerIcon}>
        <MethodIcon method={method} />
      </span>
      <div className={styles.methodExplainerCopy}>
        <div className={styles.methodExplainerHeading}>
          <span className={styles.methodExplainerEyebrow}>How this is scored</span>
          <span className={styles.methodBadge}>{detail.badge}</span>
        </div>
        <strong className={styles.methodExplainerTitle}>{detail.title}</strong>
        <p className={styles.methodExplainerDescription}>{detail.description}</p>
        <p className={styles.methodBestFor}>{detail.bestFor}</p>
        {method === 'judge' && (
          <span className={styles.judgeModelDisclosure}>Model: {JUDGE_MODEL}</span>
        )}
      </div>
    </div>
  );
}

function splitRuleCriteria(criteria: string): string[] {
  const terms: string[] = [];
  let current = '';
  let depth = 0;
  let escaped = false;
  for (const character of criteria) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      current += character;
      escaped = true;
    } else if ('([{'.includes(character)) {
      depth += 1;
      current += character;
    } else if (')]}'.includes(character)) {
      depth = Math.max(0, depth - 1);
      current += character;
    } else if (character === ',' && depth === 0) {
      terms.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  terms.push(current.trim());
  return terms.filter(Boolean);
}

function describeRuleCriteria(criteria: string): { descriptions: string[]; error: string } {
  const descriptions: string[] = [];
  for (const term of splitRuleCriteria(criteria)) {
    if (term === '{json}') descriptions.push('valid JSON');
    else if (term.startsWith('!')) descriptions.push(`does not contain “${term.slice(1)}”`);
    else if (term.startsWith('~')) {
      try {
        new RegExp(term.slice(1));
        descriptions.push(`regex matches /${term.slice(1)}/`);
      } catch (error) {
        return {
          descriptions,
          error: error instanceof Error ? `Invalid regex: ${error.message}` : 'Invalid regex.',
        };
      }
    } else descriptions.push(`contains “${term}”`);
  }
  return { descriptions, error: '' };
}

function RulePreview({ criteria }: { criteria: string }) {
  const parsed = describeRuleCriteria(criteria);
  if (!criteria.trim()) return null;
  return (
    <div className={parsed.error ? styles.ruleError : styles.rulePreview} role={parsed.error ? 'alert' : undefined}>
      {parsed.error || `${parsed.descriptions.length} check${parsed.descriptions.length === 1 ? '' : 's'}: ${parsed.descriptions.join(' · ')}`}
    </div>
  );
}

interface MethodStat {
  method: EvalMethod;
  count: number;
  avg: number | null;
  pending: number;
}

/** Per-method score summary for a run, so the blended aggregate can be read
 * alongside what each scoring method contributed. */
function methodBreakdown(run: EvalRun): MethodStat[] {
  const stats = new Map<EvalMethod, { scores: number[]; count: number; pending: number }>();
  for (const result of run.results) {
    const entry = stats.get(result.method) ?? { scores: [], count: 0, pending: 0 };
    entry.count += 1;
    if (result.is_pending) entry.pending += 1;
    else if (result.score != null) entry.scores.push(result.score);
    stats.set(result.method, entry);
  }
  return Array.from(stats.entries()).map(([method, entry]) => ({
    method,
    count: entry.count,
    avg:
      entry.scores.length > 0
        ? Math.round((entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length) * 10) / 10
        : null,
    pending: entry.pending,
  }));
}

interface ParsedJudgeRationale {
  text?: string;
  strengths?: string[];
  weaknesses?: string[];
}

/** Judge rationales are stored as JSON ({text, strengths, weaknesses});
 * anything unparseable renders as raw text. */
function JudgeRationale({ rationale }: { rationale: string }) {
  let parsed: ParsedJudgeRationale | null = null;
  if (rationale.startsWith('{')) {
    try {
      parsed = JSON.parse(rationale);
    } catch {
      parsed = null;
    }
  }
  if (!parsed) return <>{rationale}</>;
  const strengths = parsed.strengths ?? [];
  const weaknesses = parsed.weaknesses ?? [];
  return (
    <>
      <div>{parsed.text}</div>
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className={styles.chipRow}>
          {strengths.map((s, i) => (
            <span key={`s-${i}`} className={styles.chipStrength}>
              +{s}
            </span>
          ))}
          {weaknesses.map((w, i) => (
            <span key={`w-${i}`} className={styles.chipWeakness}>
              -{w}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

function formatSigned(value: number, decimals = 0): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

/** Cases are matched across runs by eval_case_id; a deleted case's result
 * (eval_case_id null) falls back to matching by label. */
function resultKey(result: EvalRunResult): string {
  return result.eval_case_id != null ? `id:${result.eval_case_id}` : `label:${result.label}`;
}

function openDebugInPlayground(promptId: number, model: string | null, result: EvalRunResult) {
  const params = new URLSearchParams();
  if (result.variables) {
    Object.entries(result.variables).forEach(([key, value]) => {
      if (typeof value === 'string') params.append(`var_${key}`, value);
    });
  }
  if (model) params.set('model', model);
  window.open(`/playground/${promptId}?${params.toString()}`, '_blank');
}

interface ComparisonRow {
  key: string;
  label: string;
  a: EvalRunResult | null;
  b: EvalRunResult | null;
}

function alignResults(runA: EvalRun, runB: EvalRun | null): ComparisonRow[] {
  const bByKey = new Map<string, EvalRunResult>();
  if (runB) {
    for (const result of runB.results) {
      bByKey.set(resultKey(result), result);
    }
  }

  const rows: ComparisonRow[] = [];
  const seen = new Set<string>();
  for (const result of runA.results) {
    const key = resultKey(result);
    seen.add(key);
    rows.push({ key, label: result.label, a: result, b: bByKey.get(key) ?? null });
  }
  if (runB) {
    for (const result of runB.results) {
      const key = resultKey(result);
      if (!seen.has(key)) {
        rows.push({ key, label: result.label, a: null, b: result });
      }
    }
  }
  return rows;
}

function CompareSide({
  result,
  side,
  onRate,
  onDebug,
}: {
  result: EvalRunResult | null;
  side?: string;
  onRate?: (result: EvalRunResult, stars: number) => void;
  onDebug?: (result: EvalRunResult) => void;
}) {
  if (!result) {
    return (
      <div className={styles.compareSide}>
        {side && <div className={styles.compareSideLabel}>{side}</div>}
        <div className={styles.emptyState}>No matching case in this run.</div>
      </div>
    );
  }
  return (
    <div className={styles.compareSide}>
      {side && <div className={styles.compareSideLabel}>{side}</div>}
      {result.criteria && <div className={styles.resultRationale}>Criteria: {result.criteria}</div>}
      <pre className={styles.compareOutput} tabIndex={0}>{result.output_text ?? '—'}</pre>
      {result.rationale && (
        <div className={styles.resultRationale}>
          <JudgeRationale rationale={result.rationale} />
        </div>
      )}
      {result.judge_model && <div className={styles.resultJudgeModel}>Judge: {result.judge_model}</div>}
      <div className={styles.compareSideScore}>
        {result.is_pending && onRate ? (
          <StarRating onRate={(stars) => onRate(result, stars)} />
        ) : result.is_pending ? (
          'Awaiting rating'
        ) : result.score != null ? (
          `Score: ${result.score}`
        ) : (
          '—'
        )}
        {result.score != null && result.score < DEBUG_SCORE_THRESHOLD && onDebug && (
          <Button
            variant="secondary"
            className={styles.debugButton}
            onClick={() => onDebug(result)}
          >
            Debug in Playground
          </Button>
        )}
      </div>
    </div>
  );
}

export default function EvaluateTab({ prompt, currentUser }: EvaluateTabProps) {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
  const [runNotice, setRunNotice] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [budgetExhausted, setBudgetExhausted] = useState(false);
  // Optimistic default: don't block the tab if the capability check itself fails.
  const [providerConnected, setProviderConnected] = useState(true);
  const [error, setError] = useState('');
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateGoal, setGenerateGoal] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const casesRef = useRef<EvalCase[]>([]);
  const pendingCasePatchesRef = useRef(new Map<number, Partial<EvalCase>>());
  const caseSaveTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const activeCaseSavesRef = useRef(new Map<number, Promise<void>>());
  const isMountedRef = useRef(true);
  const proposalIdRef = useRef(0);
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null);

  const variables = useMemo(
    () => extractPromptPlaceholders(prompt.generated_prompt),
    [prompt.generated_prompt],
  );
  const preflightWarnings = useMemo(
    () => {
      const structuralWarnings = runPreflightChecks(prompt.generated_prompt, {
        values: Object.fromEntries(variables.map((variable) => [variable.label, 'resolved'])),
        variableMetadata: prompt.variable_metadata,
      });
      if (cases.length === 0 || variables.length === 0) return structuralWarnings;

      const incompleteCases = cases.filter(
        (evalCase) =>
          !evalCase.intentionally_empty &&
          variables.some((variable) => !evalCase.variables?.[variable.label]?.trim()),
      );
      if (incompleteCases.length === 0) return structuralWarnings;
      return [
        {
          id: 'unresolved-eval-case-variables',
          message: `${incompleteCases.length} eval case${incompleteCases.length === 1 ? '' : 's'} still need${incompleteCases.length === 1 ? 's' : ''} values for all template variables.`,
          severity: 'warning' as const,
        },
        ...structuralWarnings,
      ];
    },
    [cases, prompt.generated_prompt, prompt.variable_metadata, variables],
  );

  const load = useCallback(async () => {
    try {
      const [caseList, runList, config] = await Promise.all([
        ApiClient.listEvalCases(prompt.id),
        ApiClient.listEvalRuns(prompt.id),
        ApiClient.getPromptsConfig().catch(() => null),
      ]);
      casesRef.current = caseList;
      setCases(caseList);
      setRuns(runList);
      setSelectedRunIds(runList[0] ? [runList[0].id] : []);
      if (config) {
        setBudgetExhausted(config.budget_exhausted);
        setProviderConnected(config.provider_connected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load eval data.');
    }
  }, [prompt.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setRunElapsedSeconds((seconds) => seconds + 1), 1_000);
    return () => clearInterval(timer);
  }, [isRunning]);

  const persistPendingCasePatch = useCallback(
    async (caseId: number) => {
      const activeSave = activeCaseSavesRef.current.get(caseId);
      if (activeSave) return activeSave;
      const patch = pendingCasePatchesRef.current.get(caseId);
      if (!patch) return;

      pendingCasePatchesRef.current.delete(caseId);
      const save = (async () => {
        try {
          const updated = await ApiClient.updateEvalCase(prompt.id, caseId, patch);
          // A newer local edit wins over this response and will be persisted next.
          if (isMountedRef.current && !pendingCasePatchesRef.current.has(caseId)) {
            casesRef.current = casesRef.current.map((evalCase) =>
              evalCase.id === caseId ? updated : evalCase,
            );
            setCases(casesRef.current);
          }
        } catch (err) {
          if (isMountedRef.current) {
            pendingCasePatchesRef.current.set(caseId, {
              ...patch,
              ...pendingCasePatchesRef.current.get(caseId),
            });
            setError(err instanceof Error ? err.message : 'Failed to update eval case.');
          }
        }
      })();
      activeCaseSavesRef.current.set(caseId, save);
      try {
        await save;
      } finally {
        activeCaseSavesRef.current.delete(caseId);
        if (pendingCasePatchesRef.current.has(caseId)) {
          if (isMountedRef.current) {
            const timer = setTimeout(() => {
              caseSaveTimersRef.current.delete(caseId);
              void persistPendingCasePatch(caseId);
            }, CASE_SAVE_DEBOUNCE_MS);
            caseSaveTimersRef.current.set(caseId, timer);
          } else {
            const finalPatch = pendingCasePatchesRef.current.get(caseId);
            pendingCasePatchesRef.current.delete(caseId);
            if (finalPatch) void ApiClient.updateEvalCase(prompt.id, caseId, finalPatch);
          }
        }
      }
    },
    [prompt.id],
  );

  const queueCasePatch = useCallback(
    (caseId: number, patch: Partial<EvalCase>) => {
      casesRef.current = casesRef.current.map((evalCase) =>
        evalCase.id === caseId ? { ...evalCase, ...patch } : evalCase,
      );
      setCases(casesRef.current);
      pendingCasePatchesRef.current.set(caseId, {
        ...pendingCasePatchesRef.current.get(caseId),
        ...patch,
      });

      const existingTimer = caseSaveTimersRef.current.get(caseId);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        caseSaveTimersRef.current.delete(caseId);
        void persistPendingCasePatch(caseId);
      }, CASE_SAVE_DEBOUNCE_MS);
      caseSaveTimersRef.current.set(caseId, timer);
    },
    [persistPendingCasePatch],
  );

  const flushCasePatch = useCallback(
    (caseId: number) => {
      const timer = caseSaveTimersRef.current.get(caseId);
      if (timer) clearTimeout(timer);
      caseSaveTimersRef.current.delete(caseId);
      void persistPendingCasePatch(caseId);
    },
    [persistPendingCasePatch],
  );

  const queueCaseVariable = useCallback(
    (caseId: number, variableName: string, value: string) => {
      const currentVariables =
        casesRef.current.find((evalCase) => evalCase.id === caseId)?.variables ?? {};
      queueCasePatch(caseId, {
        variables: { ...currentVariables, [variableName]: value },
      });
    },
    [queueCasePatch],
  );

  useEffect(() => {
    isMountedRef.current = true;
    const saveTimers = caseSaveTimersRef.current;
    const activeSaves = activeCaseSavesRef.current;
    const pendingPatches = pendingCasePatchesRef.current;
    return () => {
      isMountedRef.current = false;
      for (const timer of saveTimers.values()) clearTimeout(timer);
      for (const [caseId, patch] of pendingPatches) {
        if (!activeSaves.has(caseId)) {
          void ApiClient.updateEvalCase(prompt.id, caseId, patch);
          pendingPatches.delete(caseId);
        }
      }
      saveTimers.clear();
    };
  }, [prompt.id]);

  const handleAddCase = async () => {
    try {
      const created = await ApiClient.createEvalCase(prompt.id, {
        method: currentUser?.default_eval_method ?? 'rule',
        criteria: '',
        variables: {},
      });
      casesRef.current = [...casesRef.current, created];
      setCases(casesRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add eval case.');
    }
  };

  const handleRemoveCase = async (caseId: number) => {
    try {
      await ApiClient.deleteEvalCase(prompt.id, caseId);
      const timer = caseSaveTimersRef.current.get(caseId);
      if (timer) clearTimeout(timer);
      caseSaveTimersRef.current.delete(caseId);
      pendingCasePatchesRef.current.delete(caseId);
      casesRef.current = casesRef.current.filter((evalCase) => evalCase.id !== caseId);
      setCases(casesRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove eval case.');
    }
  };

  const handleRunEvaluation = async () => {
    if (cases.length === 0) {
      setError('Cannot run evaluation: no evaluation cases exist. Please add at least one case first.');
      return;
    }
    setRunElapsedSeconds(0);
    setIsRunning(true);
    setError('');
    try {
      // Running immediately after typing must score the latest local values,
      // not whatever the server had before the debounce elapsed.
      const hasUnsavedCaseEdits =
        activeCaseSavesRef.current.size > 0 || pendingCasePatchesRef.current.size > 0;
      if (hasUnsavedCaseEdits) {
        await Promise.all(activeCaseSavesRef.current.values());
        for (const timer of caseSaveTimersRef.current.values()) clearTimeout(timer);
        caseSaveTimersRef.current.clear();
        pendingCasePatchesRef.current.clear();
        const savedCases = await Promise.all(
          casesRef.current.map((evalCase) =>
            ApiClient.updateEvalCase(prompt.id, evalCase.id, {
              method: evalCase.method,
              name: evalCase.name,
              criteria: evalCase.criteria,
              variables: evalCase.variables,
              intentionally_empty: evalCase.intentionally_empty,
            }),
          ),
        );
        casesRef.current = savedCases;
        setCases(savedCases);
      }
      const run = await ApiClient.createEvalRun(prompt.id);
      setRuns((prev) => [run, ...prev]);
      setSelectedRunIds([run.id]);
      if (currentUser?.notify_eval_complete) {
        setRunNotice(`Evaluation complete${run.score == null ? '.' : ` — score ${run.score}.`}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation run failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a .csv file to import.');
      return;
    }
    setIsImporting(true);
    setError('');
    try {
      const imported = await ApiClient.importEvalCases(prompt.id, await file.text());
      casesRef.current = [...casesRef.current, ...imported];
      setCases(casesRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import eval cases.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setError('');
    try {
      const blob = await ApiClient.exportEvalCases(prompt.id);
      const filename = `prompt-${prompt.id}-eval-cases.csv`;
      downloadBlob(blob, filename);
      setRunNotice(`Exported ${filename}`);
      setTimeout(() => {
        setRunNotice((prev) => (prev === `Exported ${filename}` ? '' : prev));
      }, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export eval cases.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleGenerateProposals = async () => {
    setIsGenerating(true);
    setError('');
    try {
      const { proposals: generated } = await ApiClient.generateEvalCases(prompt.id, {
        goal: generateGoal.trim() || null,
      });
      setProposals(
        generated.map((proposal) => ({
          ...proposal,
          clientId: `proposal-${++proposalIdRef.current}`,
          status: 'active',
          // The generator supplies a short label; the rationale stays on the
          // card below rather than being crammed — and hard-clipped mid-word —
          // into the name field.
          name: proposal.name?.trim() || fallbackCaseName(proposal.rationale),
          intentionally_empty: variables.some(
            (variable) => !proposal.variables?.[variable.label]?.trim(),
          ),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate eval cases.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateProposal = (clientId: string, patch: Partial<ProposalItem>) => {
    setProposals((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p)));
  };

  const handleRejectProposal = (clientId: string) => {
    setProposals((prev) =>
      prev.map((proposal) =>
        proposal.clientId === clientId ? { ...proposal, status: 'removing' } : proposal,
      ),
    );
    setTimeout(
      () => setProposals((prev) => prev.filter((proposal) => proposal.clientId !== clientId)),
      PROPOSAL_REMOVE_DELAY_MS,
    );
  };

  const handleAcceptProposal = async (clientId: string) => {
    const proposal = proposals.find((item) => item.clientId === clientId);
    if (!proposal || savingProposalId) return;
    setSavingProposalId(clientId);
    try {
      const created = await ApiClient.createEvalCase(prompt.id, {
        method: proposal.method,
        name: proposal.name || null,
        criteria: proposal.criteria,
        variables: proposal.variables,
        intentionally_empty: proposal.intentionally_empty,
      });
      casesRef.current = [...casesRef.current, created];
      setCases(casesRef.current);
      handleRejectProposal(clientId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save eval case.');
    } finally {
      setSavingProposalId(null);
    }
  };

  const handleRate = async (runId: number, resultId: number, stars: number) => {
    try {
      const updated = await ApiClient.rateEvalResult(prompt.id, runId, resultId, { stars });
      setRuns((prev) => prev.map((r) => (r.id === runId ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit rating.');
    }
  };

  const toggleRunSelection = (runId: number) => {
    setSelectedRunIds((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId);
      if (prev.length >= 2) return [prev[1], runId];
      return [...prev, runId];
    });
  };

  const selectedRuns = runs
    .filter((r) => selectedRunIds.includes(r.id))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const [compareRunA, compareRunB] = selectedRuns;
  const comparisonRows = compareRunA ? alignResults(compareRunA, compareRunB ?? null) : [];

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.errorBanner} role="alert">
          <ErrorStatusIcon tone="danger" />
          <span>{error}</span>
        </div>
      )}
      {runNotice && (
        <div className={styles.successBanner} role="status" aria-live="polite">
          <SuccessStatusIcon tone="success" />
          <span>{runNotice}</span>
        </div>
      )}

      {!providerConnected && (
        <div className={styles.errorBanner} role="alert">
          <ErrorStatusIcon tone="danger" />
          <span>
            Evaluation runs and eval-case suggestions need an AI provider.{' '}
            <Link href="/settings#s-api">Connect one in Settings</Link> — bring your own OpenAI,
            Anthropic, Gemini, or self-hosted endpoint.
          </span>
        </div>
      )}

      {providerConnected && budgetExhausted && (
        <div className={styles.errorBanner} role="alert">
          <ErrorStatusIcon tone="danger" />
          <span>
            The shared monthly API budget has been reached. Evaluation runs are temporarily
            disabled until it resets.
          </span>
        </div>
      )}

      <div className={styles.workspaceGrid}>
        <section className={styles.evalPane} aria-labelledby="eval-set-heading">
          <div className={styles.headerRow}>
            <div>
              <h2 className={styles.title} id="eval-set-heading">
                Eval set
              </h2>
              <div className={styles.subtitle}>
                Build test cases, then run them against the prompt&apos;s current template.
              </div>
            </div>
            <Button
              variant="primary"
              className={styles.runButton}
              onClick={handleRunEvaluation}
              disabled={cases.length === 0 || isRunning || budgetExhausted || !providerConnected}
              title={
                cases.length === 0
                  ? 'Add at least one eval case to run an evaluation.'
                  : undefined
              }
            >
              {isRunning ? 'Running…' : 'Run evaluation'}
            </Button>
          </div>

          {isRunning && (
            <div className={styles.runProgress} role="status" aria-live="polite">
              <span className={styles.runProgressMessage}>
                <InfoStatusIcon tone="info" />
                Evaluation in progress · {runElapsedSeconds}s elapsed. Large eval sets can take a
                minute.
              </span>
              <span className={styles.progressTrack} aria-hidden="true">
                <span className={styles.progressIndicator} />
              </span>
            </div>
          )}

          <PreflightPanel warnings={preflightWarnings} />

          <div className={styles.caseToolbar}>
            <div className={styles.caseToolbarLead}>
              <Button
                variant="secondary"
                onClick={handleAddCase}
                className={styles.addButton}
                disabled={cases.length >= MAX_EVAL_CASES}
              >
                + Add case
              </Button>
              <span className={styles.countBadge}>
                {cases.length} / {MAX_EVAL_CASES} cases
              </span>
            </div>
            <div className={styles.headerActions} aria-label="Eval set CSV actions">
              <input
                ref={fileInputRef}
                className={styles.fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImport}
                aria-label="Import eval cases CSV"
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting || cases.length >= MAX_EVAL_CASES}
              >
                {isImporting ? 'Importing…' : 'Import CSV'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleExport}
                disabled={cases.length === 0 || isExporting}
              >
                {isExporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </div>
          </div>

          {cases.length === 0 ? (
            <div className={styles.emptyStateCard}>
              <div className={styles.emptyStateTitle}>No eval cases yet</div>
              <div className={styles.emptyState}>
                Add a case manually, import a CSV, or ask AI to suggest a starter set.
              </div>
            </div>
          ) : (
            <div className={styles.caseList}>
              {cases.map((c) => (
                <div key={c.id} className={styles.caseCard} data-method={c.method}>
                  <div className={styles.caseTop}>
                    <div className={styles.caseIdentity}>
                      <span className={styles.caseNumber}>
                        {String(c.position + 1).padStart(2, '0')}
                      </span>
                      <span>
                        <span className={styles.caseEyebrow}>Evaluation case</span>
                        <strong className={styles.caseHeading}>
                          {c.name?.trim() || `Untitled case ${c.position + 1}`}
                        </strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.removeButton}
                      aria-label="Remove case"
                      onClick={() => handleRemoveCase(c.id)}
                    >
                      ×
                    </button>
                  </div>
                  <label className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>
                      Case name <span className={styles.optionalLabel}>Optional</span>
                    </span>
                    <Input
                      value={c.name ?? ''}
                      onChange={(e) => queueCasePatch(c.id, { name: e.target.value })}
                      onBlur={() => flushCasePatch(c.id)}
                      placeholder={`Case ${c.position + 1} name`}
                      aria-label={`Case ${c.position + 1} name`}
                      maxLength={100}
                    />
                  </label>
                  <div className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>Scoring method</span>
                    <MethodPicker
                      ariaLabel="Scoring method"
                      value={c.method}
                      onChange={(method) => queueCasePatch(c.id, { method })}
                    />
                  </div>
                  <MethodExplainer method={c.method} />
                  {c.method !== 'manual' && (
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>
                        {c.method === 'rule' ? 'Pass criteria' : 'Grading instruction'}
                      </span>
                      <Textarea
                        value={c.criteria ?? ''}
                        onChange={(e) => queueCasePatch(c.id, { criteria: e.target.value })}
                        onBlur={() => flushCasePatch(c.id)}
                        placeholder={criteriaPlaceholder(c.method)}
                        aria-label={`${c.method} criteria`}
                        rows={c.method === 'rule' ? 2 : 3}
                      />
                    </label>
                  )}
                  {c.method === 'rule' && <RulePreview criteria={c.criteria ?? ''} />}
                  {variables.length > 0 && (
                    <div className={styles.inputSection}>
                      <div className={styles.inputSectionHeading}>
                        <span className={styles.inputSectionTitle}>Test inputs</span>
                        <span className={styles.inputSectionCaption}>
                          Values inserted into this prompt
                        </span>
                      </div>
                      <div className={styles.varsGrid}>
                        {variables.map((v) => (
                          <label key={v.key} className={styles.varLabel}>
                            <span>{v.label}</span>
                            {prompt.variable_metadata?.[v.label]?.type === 'number' ? (
                              <Input
                                type="number"
                                value={c.variables?.[v.label] ?? ''}
                                onChange={(e) => queueCaseVariable(c.id, v.label, e.target.value)}
                                onBlur={() => flushCasePatch(c.id)}
                                aria-label={`${v.label} value`}
                              />
                            ) : prompt.variable_metadata?.[v.label]?.type === 'boolean' ? (
                              <Select
                                value={c.variables?.[v.label] ?? ''}
                                onChange={(e) => queueCaseVariable(c.id, v.label, e.target.value)}
                                onBlur={() => flushCasePatch(c.id)}
                                aria-label={`${v.label} value`}
                              >
                                <option value="">Choose…</option>
                                <option value="true">True</option>
                                <option value="false">False</option>
                              </Select>
                            ) : (
                              <Textarea
                                value={c.variables?.[v.label] ?? ''}
                                onChange={(e) => queueCaseVariable(c.id, v.label, e.target.value)}
                                onBlur={() => flushCasePatch(c.id)}
                                aria-label={`${v.label} value`}
                                rows={2}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                      <label className={styles.intentionallyEmptyToggle}>
                        <input
                          type="checkbox"
                          checked={c.intentionally_empty ?? false}
                          onChange={(event) =>
                            queueCasePatch(c.id, { intentionally_empty: event.target.checked })
                          }
                          onBlur={() => flushCasePatch(c.id)}
                        />
                        Empty values are intentional for this robustness case
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={styles.generatorSection}>
            <div className={styles.sectionLabel}>AI-assisted eval set generator</div>
            <div className={styles.subtitle}>
              Propose happy-path, edge-case, and adversarial tests from the current template.
              Nothing is saved until you accept a proposal.
            </div>
            <div className={styles.generatorControls}>
              <Input
                value={generateGoal}
                onChange={(e) => setGenerateGoal(e.target.value)}
                placeholder="Optional testing goal (e.g. &quot;cover ambiguous dates&quot;)"
                maxLength={500}
                className={styles.generatorGoalInput}
              />
              <Button
                variant="secondary"
                onClick={handleGenerateProposals}
                disabled={
                  isGenerating ||
                  cases.length >= MAX_EVAL_CASES ||
                  budgetExhausted ||
                  !providerConnected
                }
              >
                {isGenerating ? 'Generating…' : 'Suggest eval cases'}
              </Button>
            </div>
            {cases.length >= MAX_EVAL_CASES && (
              <div className={styles.emptyState}>
                This prompt&apos;s eval set is already at the {MAX_EVAL_CASES}-case maximum.
              </div>
            )}

            {proposals.length > 0 && (
              <div className={styles.proposalList}>
                <div className={styles.proposalBulkActions}>
                  <span>
                    {proposals.length} proposal{proposals.length === 1 ? '' : 's'} remaining
                  </span>
                  <Button variant="secondary" onClick={() => setProposals([])}>
                    Reject rest
                  </Button>
                </div>
                {proposals.map((p, proposalIndex) => (
                  <div
                    key={p.clientId}
                    className={styles.proposalCard}
                    data-removing={p.status === 'removing'}
                    data-method={p.method}
                  >
                    <div className={styles.caseTop}>
                      <div className={styles.caseIdentity}>
                        <span className={styles.caseNumber}>
                          {String(proposalIndex + 1).padStart(2, '0')}
                        </span>
                        <span>
                          <span className={styles.caseEyebrow}>AI suggestion</span>
                          <strong className={styles.caseHeading}>
                            {p.name.trim() || `Untitled proposal ${proposalIndex + 1}`}
                          </strong>
                        </span>
                      </div>
                    </div>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>
                        Case name <span className={styles.optionalLabel}>Optional</span>
                      </span>
                      <Input
                        value={p.name}
                        onChange={(e) => handleUpdateProposal(p.clientId, { name: e.target.value })}
                        placeholder="Case name"
                        aria-label="Proposed case name"
                        maxLength={100}
                      />
                    </label>
                    <div className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Scoring method</span>
                      <MethodPicker
                        ariaLabel="Proposed scoring method"
                        value={p.method}
                        onChange={(method) => handleUpdateProposal(p.clientId, { method })}
                      />
                    </div>
                    <MethodExplainer method={p.method} />
                    {p.method !== 'manual' && (
                      <label className={styles.fieldGroup}>
                        <span className={styles.fieldLabel}>
                          {p.method === 'rule' ? 'Pass criteria' : 'Grading instruction'}
                        </span>
                        <Textarea
                          value={p.criteria ?? ''}
                          onChange={(e) =>
                            handleUpdateProposal(p.clientId, { criteria: e.target.value })
                          }
                          placeholder={criteriaPlaceholder(p.method)}
                          aria-label={`Proposed ${p.method} criteria`}
                          rows={p.method === 'rule' ? 2 : 3}
                        />
                      </label>
                    )}
                    {p.method === 'rule' && <RulePreview criteria={p.criteria ?? ''} />}
                    {variables.length > 0 && (
                      <div className={styles.inputSection}>
                        <div className={styles.inputSectionHeading}>
                          <span className={styles.inputSectionTitle}>Test inputs</span>
                          <span className={styles.inputSectionCaption}>
                            Values inserted into this prompt
                          </span>
                        </div>
                        <div className={styles.varsGrid}>
                          {variables.map((v) => (
                            <label key={v.key} className={styles.varLabel}>
                              <span>{v.label}</span>
                              {prompt.variable_metadata?.[v.label]?.type === 'number' ? (
                                <Input
                                  type="number"
                                  value={p.variables?.[v.label] ?? ''}
                                  onChange={(e) =>
                                    handleUpdateProposal(p.clientId, {
                                      variables: { ...p.variables, [v.label]: e.target.value },
                                    })
                                  }
                                />
                              ) : (
                                <Textarea
                                  value={p.variables?.[v.label] ?? ''}
                                  onChange={(e) =>
                                    handleUpdateProposal(p.clientId, {
                                      variables: { ...p.variables, [v.label]: e.target.value },
                                    })
                                  }
                                  rows={2}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                        <label className={styles.intentionallyEmptyToggle}>
                          <input
                            type="checkbox"
                            checked={p.intentionally_empty}
                            onChange={(event) =>
                              handleUpdateProposal(p.clientId, {
                                intentionally_empty: event.target.checked,
                              })
                            }
                          />
                          Empty values are intentional for this robustness case
                        </label>
                      </div>
                    )}
                    <div className={styles.proposalRationale}>{p.rationale}</div>
                    <div className={styles.proposalActions}>
                      <Button
                        variant="primary"
                        onClick={() => handleAcceptProposal(p.clientId)}
                        disabled={savingProposalId !== null || p.status === 'removing'}
                      >
                        {savingProposalId === p.clientId ? 'Accepting…' : 'Accept'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleRejectProposal(p.clientId)}
                        disabled={savingProposalId === p.clientId || p.status === 'removing'}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className={styles.historyPane} aria-labelledby="run-history">
          <div className={styles.historyHeader}>
            <div className={styles.historyTitleRow}>
              <h2 className={styles.title} id="run-history">
                Run history
              </h2>
              <span className={styles.countBadge}>
                {runs.length} {runs.length === 1 ? 'run' : 'runs'}
              </span>
            </div>
            <div className={styles.subtitle}>
              The latest run opens automatically. Select a second run to compare changes.
            </div>
          </div>

          {compareRunA && (
            <div className={styles.comparePanel} aria-live="polite">
              {compareRunB &&
                currentUser?.notify_eval_regression &&
                compareRunA.score != null &&
                compareRunB.score != null &&
                compareRunB.score < compareRunA.score && (
                  <div className={styles.regressionNotice} role="alert">
                    <ErrorStatusIcon tone="danger" />
                    <span>Score regression: {compareRunA.score} → {compareRunB.score}</span>
                  </div>
                )}

              <div className={styles.compareHeaderRow}>
                <h3 className={styles.sectionLabel}>
                  {compareRunB
                    ? `Comparing v${compareRunA.prompt_version_number} → v${compareRunB.prompt_version_number}`
                    : `Run detail — v${compareRunA.prompt_version_number}`}
                </h3>
                <button
                  type="button"
                  className={styles.compareClearButton}
                  onClick={() => setSelectedRunIds([])}
                >
                  Clear selection
                </button>
              </div>

              <div className={styles.runMeta}>
                <span>
                  <span className={styles.runMetaLabel}>Model</span>{' '}
                  {compareRunB ? (
                    <>
                      {compareRunA.model || '—'} → {compareRunB.model || '—'}
                      {compareRunA.model !== compareRunB.model && (
                        <span className={styles.compareChanged}> (changed)</span>
                      )}
                    </>
                  ) : (
                    compareRunA.model || '—'
                  )}
                </span>
                <span>
                  <span className={styles.runMetaLabel}>
                    {compareRunB ? 'Latency Δ' : 'Latency'}
                  </span>{' '}
                  {compareRunB
                    ? formatSigned(compareRunB.total_latency_ms - compareRunA.total_latency_ms)
                    : compareRunA.total_latency_ms}
                  ms
                </span>
                <span>
                  <span className={styles.runMetaLabel}>
                    {compareRunB ? 'Tokens Δ' : 'Tokens'}
                  </span>{' '}
                  {compareRunB
                    ? formatSigned(
                        compareRunB.total_prompt_tokens +
                          compareRunB.total_completion_tokens -
                          (compareRunA.total_prompt_tokens + compareRunA.total_completion_tokens),
                      )
                    : compareRunA.total_prompt_tokens + compareRunA.total_completion_tokens}
                </span>
                <span>
                  <span className={styles.runMetaLabel}>
                    {compareRunB ? 'Cost Δ' : 'Cost'}
                  </span>{' '}
                  $
                  {compareRunB
                    ? formatSigned(compareRunB.total_cost_usd - compareRunA.total_cost_usd, 6)
                    : compareRunA.total_cost_usd.toFixed(6)}
                </span>
              </div>

              <div className={styles.compareCaseList}>
                {comparisonRows.map((row) => (
                  <div key={row.key} className={styles.compareCaseRow}>
                    <div className={styles.compareCaseLabel}>{row.label}</div>
                    <div
                      className={styles.compareSides}
                      data-mode={compareRunB ? 'diff' : 'single'}
                    >
                      <CompareSide
                        result={row.a}
                        side={compareRunB ? 'A' : undefined}
                        onRate={(result, stars) =>
                          handleRate(compareRunA.id, result.id, stars)
                        }
                        onDebug={(result) =>
                          openDebugInPlayground(prompt.id, compareRunA.model, result)
                        }
                      />
                      {compareRunB && (
                        <CompareSide
                          result={row.b}
                          side="B"
                          onRate={(result, stars) =>
                            handleRate(compareRunB.id, result.id, stars)
                          }
                          onDebug={(result) =>
                            openDebugInPlayground(prompt.id, compareRunB.model, result)
                          }
                        />
                      )}
                    </div>
                    {compareRunB && row.a?.score != null && row.b?.score != null && (
                      <div className={styles.compareScoreDelta}>
                        Δ score {formatSigned(row.b.score - row.a.score)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {runs.length === 0 ? (
            <div className={styles.emptyStateCard}>
              <div className={styles.emptyStateTitle}>No evaluation runs yet</div>
              <div className={styles.emptyState}>
                Add at least one case, then run the evaluation to see scores and outputs here.
              </div>
            </div>
          ) : (
            <div className={styles.runList}>
              {runs.map((run) => {
                const hasCriticalFailure = run.results.some(
                  (result) => result.score != null && result.score < 40,
                );
                const hasPending = run.results.some((result) => result.is_pending);
                return (
                  <div
                    key={run.id}
                    className={
                      hasCriticalFailure
                        ? `${styles.runCard} ${styles.runCardCritical}`
                        : styles.runCard
                    }
                    data-selected={selectedRunIds.includes(run.id)}
                  >
                    <div className={styles.runHeader}>
                      <span className={styles.runVersion}>v{run.prompt_version_number}</span>
                      <span className={styles.runDate}>{formatDate(run.created_at)}</span>
                      {run.score != null ? (
                        <>
                          <span className={styles.runScore}>{run.score}</span>
                          {hasCriticalFailure && (
                            <span className={styles.criticalBadge}>Critical case failure</span>
                          )}
                        </>
                      ) : (
                        <span className={styles.runPending}>
                          {hasPending ? 'Awaiting ratings' : 'No score'}
                        </span>
                      )}
                      <label className={styles.compareToggle}>
                        <input
                          type="checkbox"
                          checked={selectedRunIds.includes(run.id)}
                          onChange={() => toggleRunSelection(run.id)}
                          aria-label={`Select run v${run.prompt_version_number} from ${formatDate(run.created_at)} for details or comparison`}
                        />
                        Select
                      </label>
                    </div>
                    <div className={styles.runMeta}>
                      <span>
                        <span className={styles.runMetaLabel}>Model</span> {run.model || '—'}
                      </span>
                      <span>
                        <span className={styles.runMetaLabel}>Latency</span>{' '}
                        {run.total_latency_ms}ms
                      </span>
                      <span>
                        <span className={styles.runMetaLabel}>Tokens</span>{' '}
                        {run.total_prompt_tokens + run.total_completion_tokens}
                      </span>
                      <span>
                        <span className={styles.runMetaLabel}>Cost</span> $
                        {run.total_cost_usd.toFixed(6)}
                      </span>
                    </div>
                    {run.results.length > 0 && (
                      <div className={styles.runBreakdown}>
                        {methodBreakdown(run).map((stat) => (
                          <span key={stat.method} className={styles.runBreakdownItem}>
                            <span className={styles.runMetaLabel}>{stat.method}</span>{' '}
                            {stat.count}
                            {stat.avg != null && ` · avg ${stat.avg}`}
                            {stat.pending > 0 && ` · ${stat.pending} pending`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
