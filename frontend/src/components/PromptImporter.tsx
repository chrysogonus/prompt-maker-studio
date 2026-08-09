/**
 * PromptImporter component - converts natural language text into structured prompt fields
 * via an LLM call, and populates the Prompt Configuration panel.
 *
 * This is the primary entry point of the compose flow, so it renders as a full-width hero
 * above the editor panels and is expanded by default. After a successful import it collapses
 * itself to a result bar so it stops competing with the fields the user is now editing.
 */

'use client';

import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from 'react';
import Link from 'next/link';
import { ApiClient } from '@/lib/api';
import { PromptField } from '@/types/prompt';
import styles from './PromptImporter.module.css';

interface PromptImporterProps {
  onImport: (fields: PromptField[]) => void;
  /** Fields a successful import would overwrite; drives the replace warning. */
  existingFieldCount?: number;
  /** Passed by the parent only while the pre-import field state can still be restored. */
  onUndo?: () => void;
}

const STORAGE_KEY = 'prompt-importer:open';

/** Mirrors ParseTextRequest.max_length in backend/app/models/schemas.py. */
const MAX_IMPORT_CHARS = 10_000;
/** Only surface the counter once the ceiling is actually in reach. */
const COUNTER_THRESHOLD = 9_000;

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: 'Story',
    text: 'Write a dark fantasy short story about a lone knight seeking redemption. Gritty tone, vivid world-building, roughly 800 words, ending on an unresolved note.',
  },
  {
    label: 'Blog post',
    text: 'Write a practical blog post explaining database indexing to backend developers who have never tuned a query. Friendly but technical, with a worked example and a short summary at the end.',
  },
  {
    label: 'Code review',
    text: 'Review a Python pull request for correctness, security and readability. Point out concrete problems with file and line references, suggest fixes, and skip stylistic nitpicks the linter already covers.',
  },
];

function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2l1.9 5.6a4 4 0 0 0 2.5 2.5L22 12l-5.6 1.9a4 4 0 0 0-2.5 2.5L12 22l-1.9-5.6a4 4 0 0 0-2.5-2.5L2 12l5.6-1.9a4 4 0 0 0 2.5-2.5L12 2z" />
    </svg>
  );
}

export default function PromptImporter({
  onImport,
  existingFieldCount = 0,
  onUndo,
}: PromptImporterProps) {
  // Open by default: only an explicit collapse is remembered.
  const [isOpen, setIsOpen] = useState(true);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState<number | null>(null);
  // Optimistic default: don't block the feature if the capability check itself fails.
  const [aiAvailable, setAiAvailable] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setIsOpen(localStorage.getItem(STORAGE_KEY) !== 'false');
  }, []);

  useEffect(() => {
    ApiClient.getPromptsConfig()
      .then(cfg => setAiAvailable(cfg.provider_connected))
      .catch(() => setAiAvailable(true));
  }, []);

  const toggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  const canSubmit = !isLoading && !!text.trim() && aiAvailable;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      const result = await ApiClient.parsePromptText({ text: text.trim() });
      onImport(result.fields);
      setImportedCount(result.fields.length);
      // Collapse without persisting, so a reload comes back to the open hero. The text is
      // deliberately kept, which puts re-importing after a tweak one edit away.
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse text. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const handleUseExample = (example: string) => {
    setText(example);
    textareaRef.current?.focus();
  };

  const handleUndo = () => {
    onUndo?.();
    setImportedCount(null);
    setIsOpen(true);
  };

  return (
    <section className={styles.hero} aria-labelledby="ai-import-title">
      <div className={styles.header}>
        <span className={styles.iconChip}>
          <SparkleIcon size={18} />
        </span>
        <div className={styles.headerText}>
          <h2 id="ai-import-title" className={styles.title}>
            Start with AI — import from text
          </h2>
          <p className={styles.description}>
            Describe what you want in plain language. AI turns it into structured prompt fields
            you can edit.
          </p>
        </div>
        <div className={styles.headerActions}>
          {isOpen && (
            <kbd className={styles.shortcut} title="Ctrl+Enter / ⌘↵ to import">
              Ctrl + Enter
            </kbd>
          )}
          <button
            type="button"
            className={styles.collapseButton}
            onClick={toggleOpen}
            aria-expanded={isOpen}
            aria-controls="ai-import-body"
            aria-label={isOpen ? 'Collapse AI import panel' : 'Expand AI import panel'}
          >
            <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>›</span>
          </button>
        </div>
      </div>

      <div id="ai-import-body">
        {importedCount !== null && (
          <div className={styles.resultBar} role="status">
            <span className={styles.resultText}>
              <SparkleIcon size={14} />
              Imported {importedCount} {importedCount === 1 ? 'field' : 'fields'} into Prompt
              Configuration
            </span>
            <span className={styles.resultActions}>
              {!isOpen && (
                <button type="button" className={styles.linkButton} onClick={() => setIsOpen(true)}>
                  Edit text
                </button>
              )}
              {onUndo && (
                <button type="button" className={styles.linkButton} onClick={handleUndo}>
                  Undo
                </button>
              )}
            </span>
          </div>
        )}

        {isOpen && (
          <form onSubmit={handleSubmit} className={styles.form}>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              className={styles.textarea}
              placeholder="e.g. Write a dark fantasy story about a lone knight seeking redemption, with a gritty tone and vivid world-building..."
              aria-label="Describe your prompt"
              rows={4}
              maxLength={MAX_IMPORT_CHARS}
              disabled={isLoading || !aiAvailable}
              spellCheck={false}
            />

            {!text.trim() && aiAvailable && (
              <div className={styles.examples}>
                <span className={styles.examplesLabel}>Try:</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    className={styles.chip}
                    onClick={() => handleUseExample(example.text)}
                    disabled={isLoading}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            )}

            {!aiAvailable && (
              <p className={styles.notice}>
                AI import needs an AI provider.{' '}
                <Link href="/settings#s-api">Connect one in Settings</Link> — bring your own
                OpenAI, Anthropic, Gemini, or self-hosted endpoint.
              </p>
            )}

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <div className={styles.footer}>
              <div className={styles.footerNotes}>
                {existingFieldCount > 0 && (
                  <p className={styles.warning}>
                    Importing replaces your {existingFieldCount} current{' '}
                    {existingFieldCount === 1 ? 'field' : 'fields'}.
                  </p>
                )}
                {text.length > COUNTER_THRESHOLD && (
                  <p className={styles.counter}>
                    {text.length.toLocaleString()} / {MAX_IMPORT_CHARS.toLocaleString()} characters
                  </p>
                )}
                {isLoading && (
                  <p className={styles.status} role="status">
                    Analyzing your description…
                  </p>
                )}
              </div>
              <button type="submit" className={styles.button} disabled={!canSubmit}>
                {isLoading ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <SparkleIcon />
                    Parse &amp; Import Fields
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
