/**
 * The mockup's Playground screen: pick a model, fill in the template's
 * {{variable}} values, run it against the user's own (billed) LLM provider,
 * and see the output plus latency/tokens/cost. Proactively disables itself
 * when the user has no provider connected, mirroring PromptImporter's. Input
 * controls adapt to each variable's persisted type (number/boolean/text/list)
 * — a native `type="number"` input already keeps the value numeric-or-empty,
 * so no extra client-side validation is layered on top. Substitution itself
 * still happens as plain-string replacement.
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Button from './ui/Button';
import Textarea from './ui/Textarea';
import Select from './ui/Select';
import Input from './ui/Input';
import Toggle from './ui/Toggle';
import PreflightPanel from './ui/PreflightPanel';
import { ApiClient, PROMPT_NOT_FOUND_MESSAGE, isValidPromptId } from '@/lib/api';
import { extractPromptPlaceholders } from '@/lib/placeholders';
import { runPreflightChecks } from '@/lib/preflight';
import { PromptHistoryResponse, PlaygroundRunResponse, PlaygroundRunHistoryResponse } from '@/types/prompt';
import styles from './PlaygroundView.module.css';
import { pageTitle } from '@/lib/branding';

interface PlaygroundViewProps {
  promptId: number;
}

const HISTORY_PAGE_SIZE = 20;

function formatHistoryDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PlaygroundView({ promptId }: PlaygroundViewProps) {
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState<PromptHistoryResponse | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  // Optimistic default: don't block the feature if the capability check itself fails.
  const [providerConnected, setProviderConnected] = useState(true);
  const [budgetExhausted, setBudgetExhausted] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundRunResponse | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<PlaygroundRunHistoryResponse[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    if (!isValidPromptId(promptId)) {
      setLoadError(PROMPT_NOT_FOUND_MESSAGE);
      setIsLoading(false);
      return;
    }
    try {
      const [p, config] = await Promise.all([
        ApiClient.getPromptById(promptId),
        ApiClient.getPromptsConfig().catch(() => ({
          provider_connected: true,
          provider: null,
          provider_label: null,
          model: null,
          available_models: [] as string[],
          budget_exhausted: false,
          global_budget_remaining_usd: null,
        })),
      ]);
      setPrompt(p);
      // Boolean toggles start in the off position, which is a meaningful
      // `false` rather than "not filled in yet" — seed it so the run sends the
      // value the user is actually looking at. Existing entries win, so a
      // deep-linked `?var_x=true` handoff isn't clobbered.
      const booleanDefaults = Object.fromEntries(
        extractPromptPlaceholders(p.generated_prompt)
          .filter((v) => p.variable_metadata?.[v.label]?.type === 'boolean')
          .map((v) => [v.label, 'false']),
      );
      if (Object.keys(booleanDefaults).length > 0) {
        setFieldValues((prev) => ({ ...booleanDefaults, ...prev }));
      }
      setProviderConnected(config.provider_connected);
      setBudgetExhausted(config.budget_exhausted);
      setAvailableModels(config.available_models);
      if (config.available_models.length > 0) {
        const requestedModel =
          typeof window === 'undefined'
            ? null
            : new URLSearchParams(window.location.search).get('model');
        setSelectedModel(
          requestedModel && config.available_models.includes(requestedModel)
            ? requestedModel
            : config.available_models[0],
        );
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load prompt.');
    } finally {
      setIsLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    load();
  }, [load]);

  // See EditorDetail: the failure states get a real title too.
  const isNotFound = !prompt && loadError.toLowerCase().includes('not found');

  useEffect(() => {
    if (isLoading) return;
    document.title = pageTitle(
      prompt
        ? `Playground · ${prompt.name ?? 'Untitled'}`
        : isNotFound
          ? 'Prompt not found'
          : 'Could not load prompt',
    );
    return () => {
      document.title = pageTitle();
    };
  }, [isLoading, isNotFound, prompt, searchParams]);

  const loadHistory = useCallback(
    async (offset: number = 0) => {
      setIsLoadingHistory(true);
      try {
        const runs = await ApiClient.getPlaygroundRuns(promptId, HISTORY_PAGE_SIZE, offset);
        setHistory((prev) => (offset === 0 ? runs : [...prev, ...runs]));
        setHistoryHasMore(runs.length === HISTORY_PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load run history.');
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [promptId],
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const initialVars: Record<string, string> = {};
      params.forEach((val, key) => {
        if (key.startsWith('var_')) {
          initialVars[key.substring(4)] = val;
        }
      });
      if (Object.keys(initialVars).length > 0) {
        setFieldValues(prev => ({ ...prev, ...initialVars }));
      }
    }
  }, []);

  const handleRun = async () => {
    setIsRunning(true);
    setError('');
    setResult(null);
    try {
      const response = await ApiClient.runPlayground(promptId, {
        model: selectedModel,
        variables: fieldValues,
      });
      setResult(response);
      // Re-running always inserts a new immutable playground_runs row; refresh
      // the history list from the top rather than optimistically prepending,
      // since the server is the source of truth for id/timestamp.
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playground run failed. Please try again.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleLoadFromHistory = (run: PlaygroundRunHistoryResponse) => {
    setSelectedModel(run.model);
    setFieldValues(run.input_variables ?? {});
    if (run.status === 'success') {
      setResult({
        output_text: run.output_text,
        latency_ms: run.latency_ms,
        prompt_tokens: run.prompt_tokens,
        completion_tokens: run.completion_tokens,
        cost_usd: run.cost_usd,
        model: run.model,
      });
      setError('');
    } else {
      setResult(null);
      setError(run.error_message || 'Playground run failed.');
    }
  };

  const preflightWarnings = useMemo(
    () =>
      prompt
        ? runPreflightChecks(prompt.generated_prompt, {
            values: fieldValues,
            variableMetadata: prompt.variable_metadata,
          })
        : [],
    [prompt, fieldValues],
  );

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading prompt...</p>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className={styles.loadError} role="alert">
        <h1>{isNotFound ? 'Prompt not found' : 'Could not load prompt'}</h1>
        <p>{loadError || 'The prompt could not be loaded.'}</p>
        <div className={styles.loadErrorActions}>
          {!isNotFound && <Button variant="primary" onClick={load}>Retry</Button>}
          <Link href="/library">Back to Library</Link>
        </div>
      </div>
    );
  }

  const variables = extractPromptPlaceholders(prompt.generated_prompt);
  // Preflight is advisory everywhere it appears and must never gate the action
  // it warns about — the warnings are rendered by PreflightPanel below instead.
  const canRun = providerConnected && !budgetExhausted && !!selectedModel && !isRunning;

  return (
    <div className={styles.playground}>
      <div className={styles.breadcrumb}>
        <Link href="/library">Library</Link>
        <span>/</span>
        <Link href={`/editor/${promptId}`}>{prompt.name ?? 'Untitled'}</Link>
        <span>/</span>
        <span className={styles.breadcrumbCurrent}>Playground</span>
      </div>

      <h1 className={styles.title}>Test · {prompt.name ?? 'Untitled'}</h1>

      {!providerConnected && (
        <div className={styles.notice}>
          The Playground needs an AI provider.{' '}
          <Link href="/settings#s-api">Connect one in Settings</Link> — bring your own OpenAI,
          Anthropic, Gemini, or self-hosted endpoint.
        </div>
      )}

      {providerConnected && budgetExhausted && (
        <div className={styles.notice}>
          The shared monthly API budget has been reached. Runs are temporarily disabled until it
          resets.
        </div>
      )}

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.grid}>
        <div className={styles.inputsColumn}>
          <div className={styles.sectionLabel}>Model</div>
          <Select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={!providerConnected || availableModels.length === 0}
            aria-label="Model"
          >
            {availableModels.length === 0 && <option value="">No models available</option>}
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>

          {variables.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Inputs</div>
              <div className={styles.fields}>
                {variables.map((v) => {
                  const type = prompt.variable_metadata?.[v.label]?.type ?? 'text';
                  return (
                    <div key={v.key}>
                      <div className={styles.fieldLabel}>{v.label}</div>
                      {type === 'number' ? (
                        <Input
                          type="number"
                          value={fieldValues[v.label] ?? ''}
                          onChange={(e) =>
                            setFieldValues((prev) => ({ ...prev, [v.label]: e.target.value }))
                          }
                          aria-label={v.label}
                        />
                      ) : type === 'boolean' ? (
                        <Toggle
                          checked={fieldValues[v.label] === 'true'}
                          onChange={(checked) =>
                            setFieldValues((prev) => ({
                              ...prev,
                              [v.label]: checked ? 'true' : 'false',
                            }))
                          }
                          label={v.label}
                        />
                      ) : (
                        <Textarea
                          mono
                          rows={3}
                          value={fieldValues[v.label] ?? ''}
                          onChange={(e) =>
                            setFieldValues((prev) => ({ ...prev, [v.label]: e.target.value }))
                          }
                          aria-label={v.label}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <PreflightPanel warnings={preflightWarnings} />

          <div className={styles.runRow}>
            <Button variant="primary" onClick={handleRun} disabled={!canRun}>
              {isRunning ? 'Running…' : 'Run'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsHistoryOpen((prev) => !prev)}
              aria-expanded={isHistoryOpen}
            >
              {isHistoryOpen ? 'Hide history' : `History (${history.length})`}
            </Button>
          </div>
        </div>

        <div className={styles.outputColumn}>
          <div className={styles.sectionLabel}>Output</div>
          <pre className={styles.output} role="status" aria-live="polite" aria-label="Playground output">
            {result?.output_text ?? ''}
          </pre>
          {result && (
            <div className={styles.metrics}>
              <span>
                <span className={styles.metricLabel}>Model</span> {result.model}
              </span>
              <span>
                <span className={styles.metricLabel}>Latency</span> {result.latency_ms}ms
              </span>
              <span>
                <span className={styles.metricLabel}>Tokens</span>{' '}
                {result.prompt_tokens + result.completion_tokens}
              </span>
              <span>
                <span className={styles.metricLabel}>Cost</span> ${result.cost_usd.toFixed(6)}
              </span>
            </div>
          )}
        </div>
      </div>

      {isHistoryOpen && (
        <div className={styles.historyPanel}>
          <div className={styles.sectionLabel}>Run history</div>
          {history.length === 0 && !isLoadingHistory ? (
            <div className={styles.notice}>No runs yet — run this prompt to build up history.</div>
          ) : (
            <div className={styles.historyList}>
              {history.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={styles.historyRow}
                  onClick={() => handleLoadFromHistory(run)}
                >
                  <span className={styles.historyStatus} data-status={run.status}>
                    {run.status === 'error' ? 'Error' : 'OK'}
                  </span>
                  <span className={styles.historyModel}>{run.model}</span>
                  <span className={styles.historyDate}>{formatHistoryDate(run.created_at)}</span>
                  <span className={styles.historyMetric}>{run.latency_ms}ms</span>
                  <span className={styles.historyMetric}>
                    {run.prompt_tokens + run.completion_tokens} tok
                  </span>
                  <span className={styles.historyMetric}>${run.cost_usd.toFixed(6)}</span>
                </button>
              ))}
            </div>
          )}
          {historyHasMore && (
            <Button
              variant="secondary"
              onClick={() => loadHistory(history.length)}
              disabled={isLoadingHistory}
            >
              {isLoadingHistory ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
