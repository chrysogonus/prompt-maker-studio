'use client';

import { useLayoutEffect, useRef } from 'react';
import { sectionTag, unbalancedTags } from '@/lib/sections';
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
}

export default function SectionCard({
  section,
  index,
  count,
  nameError,
  onChange,
  onMove,
  onRemove,
}: SectionCardProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const label = section.name.trim() || 'Untitled section';
  const tag = sectionTag(section.name) || 'SECTION';
  const unclosed = unbalancedTags(section.content);
  // A blank name only matters once the section has been left or saved; a
  // name typed wrong is worth flagging straight away.
  const showNameError = Boolean(nameError && (section.touched || section.name.trim()));

  // Grow with the content instead of scrolling inside a small box.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [section.content]);

  const nameId = `section-name-${section.key}`;
  const errorId = `section-error-${section.key}`;

  return (
    <div
      className={styles.section}
      data-invalid={showNameError}
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
        onBlur={() => !section.touched && onChange({ touched: true })}
        placeholder={section.hint || 'Write this section…'}
        aria-label={`${label} text`}
        rows={1}
      />
      {showNameError && (
        <p id={errorId} className={styles.sectionError}>
          {nameError}
        </p>
      )}
      {unclosed.length > 0 && (
        <p className={styles.sectionWarning}>
          {unclosed.map((name) => `<${name}>`).join(', ')} opens and closes an uneven number of
          times in this section. Check for a missing or extra tag.
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
