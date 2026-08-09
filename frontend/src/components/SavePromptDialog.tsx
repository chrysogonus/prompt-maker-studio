/**
 * Dialog for saving a prompt with a custom name
 */

'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Button from './ui/Button';
import styles from './SavePromptDialog.module.css';

interface SavePromptDialogProps {
  isOpen: boolean;
  currentName?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function SavePromptDialog({
  isOpen,
  currentName = '',
  onSave,
  onCancel,
}: SavePromptDialogProps) {
  const [name, setName] = useState(currentName);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleCancel = () => {
    setName('');
    onCancel();
  };

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const appShell = document.getElementById('app-shell');
    appShell?.setAttribute('inert', '');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const items = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      appShell?.removeAttribute('inert');
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      setName('');
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={handleCancel}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={currentName ? 'Update Prompt Name' : 'Save Prompt'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>
          {currentName ? 'Update Prompt Name' : 'Save Prompt'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="prompt-name" className={styles.label}>
              Prompt Name
            </label>
            <input
              id="prompt-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              placeholder="e.g., Fantasy Character Creator"
              autoFocus
              maxLength={100}
            />
            <div className={styles.characterCount}>
              {name.length} / 100
            </div>
          </div>

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              {currentName ? 'Update' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
