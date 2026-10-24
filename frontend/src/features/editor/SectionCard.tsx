'use client';

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { insertVariable, isVariableName, sectionTag, toVariableName, unbalancedTags } from '@/lib/sections';
import type { EditorSection } from './PromptEditor';
import styles from './PromptEditor.module.css';

interface SectionCardProps {
  section: EditorSection;
  index: number;
  count: number;
  nameError: string | null;
  onChange: (change: Partial<EditorSection>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  /** Selected text replaced by a new input becomes that input's example. */
  onVariableInserted: (name: string, example: string) => void;
}

function fitHeight(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export default function SectionCard({
  section,
  index,
  count,
  nameError,
  onChange,
  onMove,
  onRemove,
  onVariableInserted,
}: SectionCardProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  // The button takes focus, so remember where the text was selected when it left.
  const selection = useRef<{ start: number; end: number } | null>(null);
  const caret = useRef<number | null>(null);
  const [insert, setInsert] = useState<{ start: number; end: number; name: string; error: string } | null>(null);
  const label = section.name.trim() || 'Untitled section';
  const tag = sectionTag(section.name) || 'SECTION';
  const unclosed = unbalancedTags(section.content);
  const [dismissedTags, setDismissedTags] = useState<string | null>(null);
  const warningTags = unclosed.join(', ');
  // A blank name only matters once the section has been left or saved; a
  // name typed wrong is worth flagging straight away.
  const showNameError = Boolean(nameError && (section.touched || section.name.trim()));
  const contentError = Array.from(section.content).length > 10000;

  // Grow with the content instead of scrolling inside a small box.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    fitHeight(el);
    if (caret.current !== null) {
      el.focus();
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [section.content]);

  // A hidden editor (Fill and copy) measures 0, and a new width rewraps the
  // text, so refit whenever the box's width changes.
  useEffect(() => {
    const el = textRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitHeight(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startInsert = () => {
    const length = section.content.length;
    const { start, end } = selection.current ?? { start: length, end: length };
    setInsert({ start: Math.min(start, length), end: Math.min(end, length), name: '', error: '' });
  };
  const cancelInsert = () => {
    setInsert(null);
    textRef.current?.focus();
  };
  const confirmInsert = (event: FormEvent) => {
    event.preventDefault();
    if (!insert) return;
    // "Target audience" or "max rows!" becomes target_audience / max_rows rather than an error;
    // letters outside ASCII ("Größe") would be dropped, so those still get the error.
    const typed = insert.name.trim();
    const name = isVariableName(typed) || /[^\x00-\x7F]/.test(typed) ? typed : toVariableName(typed);
    if (!isVariableName(name)) {
      setInsert({ ...insert, error: 'Start with a letter or _, then use letters, numbers, _ or -.' });
      return;
    }
    const next = insertVariable(section.content, insert.start, insert.end, name);
    caret.current = next.caret;
    onChange({ content: next.text, touched: true });
    if (next.replaced.trim()) onVariableInserted(name, next.replaced);
    setInsert(null);
  };
  const replacing = insert ? section.content.slice(insert.start, insert.end) : '';

  const nameId = `section-name-${section.key}`;
  const errorId = `section-error-${section.key}`;
  const contentErrorId = `section-content-error-${section.key}`;

  return (
    <div
      className={styles.section}
      data-invalid={showNameError || contentError}
    >
      <div className={styles.sectionHead}>
        <input
          id={nameId}
          className={styles.sectionName}
          value={section.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Section name"
          aria-label="Section name"
          aria-invalid={showNameError}
          aria-describedby={showNameError ? errorId : undefined}
          maxLength={100}
          spellCheck={false}
        />
        <span className={styles.sectionTag} aria-hidden="true">
          &lt;{tag}&gt;
        </span>
        <div className={styles.sectionTools}>
          <button
            type="button"
            className={styles.insertTool}
            onClick={startInsert}
            aria-label={`Insert input in ${label}`}
            title="Insert input: select text first to turn it into an input"
          >
            {'{{ }}'}
          </button>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move ${label} up`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label={`Move ${label} down`}
          >
            ↓
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}>
            ×
          </button>
        </div>
      </div>
      <textarea
        ref={textRef}
        className={styles.sectionText}
        value={section.content}
        onChange={(e) => onChange({ content: e.target.value })}
        onBlur={(e) => {
          selection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd };
          if (!section.touched) onChange({ touched: true });
        }}
        placeholder={section.hint || 'Write this section…'}
        aria-label={`${label} text`}
        aria-invalid={contentError}
        aria-describedby={contentError ? contentErrorId : undefined}
        rows={1}
      />
      {insert && (
        <form className={styles.insertForm} onSubmit={confirmInsert}>
          <label htmlFor={`insert-${section.key}`}>
            {replacing.trim()
              ? `Input name for “${replacing.length > 40 ? `${replacing.slice(0, 40)}…` : replacing}” (kept as its example)`
              : 'New input name'}
          </label>
          <input
            id={`insert-${section.key}`}
            value={insert.name}
            onChange={(e) => setInsert({ ...insert, name: e.target.value, error: '' })}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelInsert(); } }}
            placeholder="e.g. city"
            maxLength={100}
            autoFocus
            aria-invalid={!!insert.error}
            aria-describedby={insert.error ? `insert-error-${section.key}` : undefined}
            spellCheck={false}
          />
          <Button type="submit" variant="secondary">Insert</Button>
          <Button type="button" variant="ghost" onClick={cancelInsert}>Cancel</Button>
          {insert.error && <p id={`insert-error-${section.key}`} className={styles.sectionError} role="alert">{insert.error}</p>}
        </form>
      )}
      {contentError && <p id={contentErrorId} className={styles.sectionError}>Section text must be 10,000 characters or fewer.</p>}
      {showNameError && (
        <p id={errorId} className={styles.sectionError}>
          {nameError}
        </p>
      )}
      {unclosed.length > 0 && dismissedTags !== warningTags && (
        <p className={styles.sectionWarning}>
          Possible unmatched tag: {unclosed.map((name) => `<${name}>`).join(', ')}.
          {' '}Literal text is fine; saving and copying still work.
          {' '}<button type="button" className={styles.link} aria-label={`Dismiss markup warning for ${label}`} onClick={() => setDismissedTags(warningTags)}>Dismiss</button>
        </p>
      )}
      {section.touched && !section.content.trim() && (
        <p className={styles.emptyWarning}>
          This section is empty. It will still appear in the prompt as an empty &lt;{tag}&gt; tag.
        </p>
      )}
    </div>
  );
}
