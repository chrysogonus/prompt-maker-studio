/**
 * Output panel component - right side of the interface
 * Displays the generated prompt with save functionality
 */

'use client';

import { Fragment, useMemo, useState } from 'react';
import { compilePrompt, extractPromptPlaceholders } from '@/lib/placeholders';
import { runPreflightChecks } from '@/lib/preflight';
import SegmentedControl from './ui/SegmentedControl';
import PreflightPanel from './ui/PreflightPanel';
import styles from './OutputPanel.module.css';

type CopyMode = 'compiled' | 'template';

const COPY_MODE_OPTIONS = [
  { value: 'compiled' as const, label: 'Compiled' },
  { value: 'template' as const, label: 'Raw' },
];

interface OutputPanelProps {
  prompt: string;
  onSave?: () => void;
  onUpdate?: () => void;
  canSave: boolean;
  canUpdate: boolean;
}

interface CodeLine {
  text: string;
  number: number;
  blockIndex: number | null;
}

function buildCodeLines(prompt: string): CodeLine[] {
  const rawLines = prompt.split('\n');
  let currentBlock: number | null = null;
  let nextBlock = 0;

  return rawLines.map((text, index) => {
    const openingTag = text.match(/^\s*<([A-Za-z_][A-Za-z0-9_-]*)>\s*$/);
    if (openingTag) {
      currentBlock = nextBlock;
      nextBlock += 1;
      return { text, number: index + 1, blockIndex: currentBlock };
    }

    const line: CodeLine = { text, number: index + 1, blockIndex: currentBlock };

    if (/^\s*<\/[A-Za-z_][A-Za-z0-9_-]*>\s*$/.test(text)) {
      currentBlock = null;
    }

    return line;
  });
}

function renderHighlightedLine(text: string) {
  const tagMatch = text.match(/^(\s*)<(\/?)([A-Za-z_][A-Za-z0-9_-]*)>\s*$/);
  if (!tagMatch) {
    return text || ' ';
  }

  const [, indent, slash, tagName] = tagMatch;

  return (
    <>
      {indent}
      <span className={styles.tagPunctuation}>{'<'}</span>
      {slash && <span className={styles.tagPunctuation}>{slash}</span>}
      <span className={styles.tagName}>{tagName}</span>
      <span className={styles.tagPunctuation}>{'>'}</span>
    </>
  );
}

export default function OutputPanel({
  prompt,
  onSave,
  onUpdate,
  canSave,
  canUpdate,
}: OutputPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyMode, setCopyMode] = useState<CopyMode>('compiled');
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const placeholders = useMemo(() => extractPromptPlaceholders(prompt), [prompt]);
  const compiledPrompt = useMemo(
    () => compilePrompt(prompt, placeholderValues),
    [placeholderValues, prompt],
  );
  const codeLines = useMemo(() => buildCodeLines(compiledPrompt), [compiledPrompt]);
  const [compileRun, setCompileRun] = useState(0);
  const preflightWarnings = useMemo(
    () => runPreflightChecks(prompt, { values: placeholderValues }),
    [prompt, placeholderValues],
  );

  const charCount = compiledPrompt.length;
  const wordCount = compiledPrompt.trim() ? compiledPrompt.trim().split(/\s+/).length : 0;
  const estimatedTokens = Math.ceil(charCount / 4);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyMode === 'template' ? prompt : compiledPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleUpdateClick = () => {
    setCompileRun(run => run + 1);
    onUpdate?.();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Generated Prompt</h2>
        {prompt && (
          <div className={styles.actions}>
            <div className={styles.copyGroup}>
              {placeholders.length > 0 ? (
                <SegmentedControl
                  aria-label="Copy mode"
                  options={COPY_MODE_OPTIONS}
                  value={copyMode}
                  onChange={setCopyMode}
                />
              ) : (
                <span className={styles.copyModeHint}>No variables — compiled and raw are identical</span>
              )}
              <button
                onClick={handleCopy}
                className={`${styles.copyButton} ${copied ? styles.copyButtonCopied : ''}`}
                title={copyMode === 'template' ? 'Copy raw template (placeholders intact)' : 'Copy compiled prompt'}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            {canUpdate && onUpdate && (
              <button
                onClick={handleUpdateClick}
                className={styles.updateButton}
                title="Update current prompt"
              >
                Update
              </button>
            )}
            {canSave && onSave && (
              <button
                onClick={onSave}
                className={styles.saveButton}
                title="Save as new prompt"
              >
                Save
              </button>
            )}
          </div>
        )}
      </div>
      
      {prompt && (
        <div className={styles.metrics}>
          <span className={styles.metricItem}>{charCount.toLocaleString()} chars</span>
          <span className={styles.metricDivider}>·</span>
          <span className={styles.metricItem}>{wordCount.toLocaleString()} words</span>
          <span className={styles.metricDivider}>·</span>
          <span className={styles.metricItem}>~{estimatedTokens.toLocaleString()} tokens</span>
        </div>
      )}

      {prompt && <PreflightPanel warnings={preflightWarnings} />}

      <div className={styles.outputBox}>
        {prompt ? (
          <div className={styles.outputContent}>
            {placeholders.length > 0 && (
              <div className={styles.variableEditor}>
                <h3 className={styles.variableTitle}>Variables</h3>
                <div className={styles.variableGrid}>
                  {placeholders.map(placeholder => (
                    <label key={placeholder.key} className={styles.variableField}>
                      <span>{placeholder.label}</span>
                      <input
                        type="text"
                        value={placeholderValues[placeholder.key] ?? ''}
                        onChange={(event) => {
                          setPlaceholderValues(prev => ({
                            ...prev,
                            [placeholder.key]: event.target.value,
                          }));
                        }}
                        className={styles.variableInput}
                        placeholder={placeholder.token}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <pre className={styles.output} role="region" aria-label={compiledPrompt}>
              <code className={styles.codeView} key={compileRun}>
                {codeLines.map((line, index) => (
                  <Fragment key={`${compileRun}-${line.number}`}>
                    <span
                      className={`${styles.codeLine} ${
                        compileRun > 0 && line.blockIndex !== null ? styles.compileLine : ''
                      }`}
                      style={{
                        animationDelay: line.blockIndex !== null
                          ? `${Math.min(line.blockIndex * 120, 960)}ms`
                          : undefined,
                      }}
                    >
                      <span className={styles.lineNumber} aria-hidden="true">
                        {line.number}
                      </span>
                      <span className={styles.lineText}>
                        {renderHighlightedLine(line.text)}
                        {index === codeLines.length - 1 && (
                          <span className={styles.cursor} aria-hidden="true" />
                        )}
                      </span>
                    </span>
                    {'\n'}
                  </Fragment>
                ))}
              </code>
            </pre>
          </div>
        ) : (
          <div className={styles.placeholderWrapper}>
            <span className={styles.placeholderIcon}>✦</span>
            <p className={styles.placeholder}>
              Your generated prompt will appear here
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
