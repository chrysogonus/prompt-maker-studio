'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClient } from '@/lib/api';
import AICallContext from '@/components/ui/AICallContext';
import { fillVariables, renderSections, sectionTag, splitVariables } from '@/lib/sections';
import { PromptField, VariableMetadataItem, PromptsConfigResponse, TryPromptResponse } from '@/types/prompt';
import styles from './PromptEditor.module.css';

// Not a limit of any particular chat app — just a quiet heads-up.
const LONG_PROMPT_CHARS = 40_000;
const TRY_PROMPT_CHARS = 100_000;

interface PreviewPaneProps {
  fields: PromptField[];
  aiConfig: PromptsConfigResponse | null;
  onLoadExamples: () => void;
  variables: string[];
  metadata: Record<string, VariableMetadataItem>;
  values: Record<string, string>;
  onValueChange: (name: string, value: string) => void;
  mode: 'template' | 'filled';
  onModeChange: (mode: 'template' | 'filled') => void;
  open: boolean;
  onToggle: () => void;
  onCopyFailed: () => void;
}

type CopyKind = 'template' | 'filled' | 'placeholders';

export default function PreviewPane({
  fields,
  aiConfig,
  onLoadExamples,
  variables,
  metadata,
  values,
  onValueChange,
  mode,
  onModeChange,
  open,
  onToggle,
  onCopyFailed,
}: PreviewPaneProps) {
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState<{ text: string; response: TryPromptResponse } | null>(null);
  const [tryError, setTryError] = useState('');
  // Kept here so the panel and its output reopen after a Template/Filled switch.
  const [tryOpen, setTryOpen] = useState(false);
  const tryingRef = useRef(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (!open) {
    return (
      <aside className={styles.previewClosed} aria-label="Preview">
        <button type="button" onClick={onToggle} aria-label="Show preview">
          Preview
        </button>
      </aside>
    );
  }

  const filled = mode === 'filled' && variables.length > 0;
  const template = renderSections(fields);
  const unfilled = variables.filter((name) => metadata[name]?.required ? !values[name]?.trim() : !values[name]);
  const missingRequired = unfilled.filter((name) => metadata[name]?.required);
  const missingOptional = unfilled.filter((name) => !metadata[name]?.required);
  const filledValues = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim() || !metadata[name]?.required ? value : '']));
  const filledText = fillVariables(template, filledValues);
  const shown = filled ? filledText : template;
  const hasContent = fields.some((field) => field.content.trim());

  const copy = async (kind: CopyKind) => {
    if (kind === 'filled' && missingRequired.length) return;
    try {
      await navigator.clipboard.writeText(kind === 'template' ? template : filledText);
      setCopied(kind);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1600);
    } catch {
      onCopyFailed();
    }
  };

  const tryOnce = async () => {
    if (filledText.length > TRY_PROMPT_CHARS || tryingRef.current || missingRequired.length || !aiConfig?.provider_connected || aiConfig.budget_exhausted) return;
    tryingRef.current = true;
    setTrying(true);
    setTryError('');
    const text = variables.length ? filledText : template;
    try {
      setResult({ text, response: await ApiClient.tryPrompt(text) });
    } catch (error) {
      setTryError(error instanceof Error ? error.message : 'Could not run this prompt. Try again.');
    } finally {
      tryingRef.current = false;
      setTrying(false);
    }
  };

  const copyKind: CopyKind = filled ? 'filled' : 'template';
  const copyLabel =
    variables.length === 0 ? 'Copy prompt' : filled ? 'Copy filled prompt' : 'Copy template';

  return (
    <aside className={styles.preview} aria-label="Preview">
      <div className={styles.previewHead}>
        <h2>Preview</h2>
        {variables.length > 0 && (
          <div className={styles.modeSwitch} role="radiogroup" aria-label="Preview mode">
            {(['template', 'filled'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => onModeChange(value)}
              >
                {value === 'template' ? 'Template' : 'Filled'}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={styles.previewToggle} onClick={onToggle}>
          Hide
        </button>
      </div>

      {filled && (
        <div className={styles.previewValues}>
          {variables.some((name) => metadata[name]?.example) && (
            <button type="button" className={styles.copyButton} data-secondary="true" onClick={onLoadExamples}>Load example inputs</button>
          )}
          {variables.map((name) => (
            <label key={name} className={styles.valueField}>
              <span>{name}{metadata[name]?.required ? ' Required' : ' Optional'}</span>
              <textarea
                value={values[name] ?? ''}
                aria-label={`${name}${metadata[name]?.required ? ' Required' : ''}`}
                aria-required={metadata[name]?.required || undefined}
                aria-invalid={missingRequired.includes(name)}
                aria-describedby={missingRequired.includes(name) ? 'required-input-warning' : undefined}
                onChange={(e) => onValueChange(name, e.target.value)}
                placeholder={metadata[name]?.description || 'Type the value'}
                rows={1}
              />
            </label>
          ))}
        </div>
      )}

      <pre className={styles.previewText} tabIndex={0} aria-label="Prompt text">
        {hasContent ? (
          fields.map((field, i) => (
            <span key={i}>
              {i > 0 && '\n\n'}
              <span className={styles.previewTag}>&lt;{sectionTag(field.name)}&gt;</span>
              {'\n'}
              {splitVariables(field.content).map((part, j) => {
                if (part.kind === 'text') return part.text;
                if (!filled) {
                  return (
                    <span key={j} className={styles.previewVariable}>
                      {part.text}
                    </span>
                  );
                }
                return filledValues[part.name!] ? (
                  <mark key={j} className={styles.previewFilled}>
                    {filledValues[part.name!]}
                  </mark>
                ) : (
                  <span key={j} className={styles.previewUnfilled}>
                    {part.text}
                  </span>
                );
              })}
              {'\n'}
              <span className={styles.previewTag}>&lt;/{sectionTag(field.name)}&gt;</span>
            </span>
          ))
        ) : (
          <span className={styles.previewEmpty}>Your prompt appears here as you write.</span>
        )}
      </pre>

      <div className={styles.previewFoot}>
        {shown.length > LONG_PROMPT_CHARS && (
          <p className={styles.previewLong}>
            Long prompt: {shown.length.toLocaleString()} characters.
          </p>
        )}
        {filled && missingRequired.length > 0 && (
          <p id="required-input-warning" className={styles.previewWarning}>Required inputs missing: {missingRequired.join(', ')}. Fill them in or choose Copy with placeholders.</p>
        )}
        {filled && missingOptional.length > 0 && (
          <p className={styles.previewLong}>
            {missingOptional.length === 1 ? (
              <>
                <code>{missingOptional[0]}</code> is not filled in.
              </>
            ) : (
              `${missingOptional.length} optional variables are not filled in.`
            )}{' '}
            They’ll be copied as placeholders.
          </p>
        )}
        <div className={styles.previewActions}>
        <button
          type="button"
          className={styles.copyButton}
          onClick={() => copy(copyKind)}
          disabled={!hasContent || (filled && missingRequired.length > 0)}
        >
          {copied === copyKind ? 'Copied' : copyLabel}
        </button>
        {filled && missingRequired.length > 0 && (
          <button type="button" className={styles.copyButton} data-secondary="true" disabled={!hasContent} onClick={() => copy('placeholders')}>
            {copied === 'placeholders' ? 'Copied with placeholders' : 'Copy with placeholders'}
          </button>
        )}
        </div>
        {(filled || variables.length === 0) && (
          <details className={styles.tryPanel} open={tryOpen} onToggle={(event) => setTryOpen(event.currentTarget.open)}>
            <summary>Test with AI</summary>
            <div className={styles.tryControls}>
              <AICallContext config={aiConfig} />
              {filledText.length > TRY_PROMPT_CHARS && <p className={styles.previewWarning}>Try once accepts up to 100,000 characters. Shorten the prompt before running.</p>}
              <button type="button" className={styles.copyButton} data-secondary="true" onClick={tryOnce}
                disabled={filledText.length > TRY_PROMPT_CHARS || trying || !hasContent || missingRequired.length > 0 || !aiConfig?.provider_connected || aiConfig.budget_exhausted}>
                {trying ? 'Running…' : 'Try once'}
              </button>
            </div>
            {trying && <p className={styles.tryResult} role="status">Running the filled prompt…</p>}
            {tryError && <p className={styles.tryResult} role="alert">{tryError}</p>}
            {result && <section className={styles.tryResult} aria-label="Try once output">
              <h3>Output</h3>
              <p>{result.response.provider} / {result.response.model}</p>
              {result.text !== (variables.length ? filledText : template) && <p>Output is from earlier inputs. Run again to try the current prompt.</p>}
              <pre tabIndex={0}>{result.response.output_text || 'The model returned no text.'}</pre>
            </section>}
          </details>
        )}
      </div>
    </aside>
  );
}
