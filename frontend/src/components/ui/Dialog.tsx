'use client';

import { ReactNode, MouseEvent, useEffect, useLayoutEffect, useRef } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export default function Dialog({ isOpen, title, onClose, children, actions, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Read through a ref so a parent passing an inline `onClose` doesn't re-run
  // the focus effect on every render, which threw focus back to the first
  // field after each keystroke.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Captured lazily during render, once per opening: a child's autoFocus moves
  // focus before any effect here runs. The effect cleanup resets it.
  if (previouslyFocused.current == null) {
    if (isOpen) previouslyFocused.current = document.activeElement as HTMLElement | null;
  }

  useEffect(() => {
    if (!isOpen) return;

    const dialogEl = dialogRef.current;
    const focusable = dialogEl?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? dialogEl)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogEl) return;

      const items = dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        e.preventDefault();
        dialogEl.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];

      const active = document.activeElement;
      if (!dialogEl.contains(active) || active === dialogEl || active?.getAttribute('tabindex') === '-1') {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
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
      // An opener that is gone (or none, when opened from a URL) leaves the
      // parent's onClose focus alone.
      const opener = previouslyFocused.current;
      if (opener?.isConnected && opener !== document.body) opener.focus();
      previouslyFocused.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={[styles.dialog, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={stop}
      >
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
