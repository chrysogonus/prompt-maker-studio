'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { diffWords } from '@/lib/diff';
import { openInApp } from '@/lib/openInApp';
import styles from '@/components/public/Tools.module.css';

const BEFORE = 'Summarize the meeting notes for {{team}} in a few bullets.';
const AFTER = 'Summarize the meeting notes for {{team}} in at most five bullets. List decisions first, then open questions.';

export default function PromptDiff() {
  const [before, setBefore] = useState(BEFORE);
  const [after, setAfter] = useState(AFTER);
  const tokens = diffWords(before, after);
  return (
    <>
      <div className={styles.columns}>
        <label className={styles.field}>
          Before
          <textarea className={styles.textarea} value={before} onChange={(event) => setBefore(event.target.value)} maxLength={50_000} />
        </label>
        <label className={styles.field}>
          After
          <textarea className={styles.textarea} value={after} onChange={(event) => setAfter(event.target.value)} maxLength={50_000} />
        </label>
      </div>
      <p className={styles.legend}><ins>Added</ins> and <del>removed</del> words.</p>
      {before === after ? (
        <p className={styles.status} role="status">Both prompts are the same.</p>
      ) : (
        <div className={styles.diff} tabIndex={0} aria-label="Changes from before to after">
          {tokens.map((token, i) =>
            token.type === 'added' ? <ins key={i}>{token.text}</ins>
              : token.type === 'removed' ? <del key={i}>{token.text}</del>
                : <span key={i}>{token.text}</span>,
          )}
        </div>
      )}
      {after.trim() && (
        <div className={styles.actions}>
          <Button onClick={() => openInApp({ fields: [{ name: 'Task', content: after }] })}>Save “After” to my library</Button>
        </div>
      )}
    </>
  );
}
