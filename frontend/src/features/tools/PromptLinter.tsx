'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { openInApp } from '@/lib/openInApp';
import { lintPrompt } from '@/lib/promptLint';
import styles from '@/components/public/Tools.module.css';

const EXAMPLE = 'Summarize this article about {{topic}}.';

export default function PromptLinter() {
  const [text, setText] = useState(EXAMPLE);
  const findings = lintPrompt(text);
  const problems = findings.filter((finding) => finding.severity === 'problem').length;
  return (
    <>
      <label className={styles.field}>
        Your prompt
        <textarea className={styles.textarea} value={text} onChange={(event) => setText(event.target.value)} maxLength={50_000} />
      </label>
      {text.trim() && (
        <>
          <p className={styles.status} role="status">
            {findings.length === 0 ? 'No issues found. The prompt states a role, a format, a length and an example.'
              : `${problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'}, ` : ''}${findings.length - problems} ${findings.length - problems === 1 ? 'suggestion' : 'suggestions'}.`}
          </p>
          {findings.length > 0 && (
            <ul className={styles.findings} aria-label="Findings">
              {findings.map((finding) => (
                <li key={finding.id} data-severity={finding.severity}>
                  <strong>{finding.severity === 'problem' ? 'Problem: ' : 'Suggestion: '}{finding.message}</strong>
                  <span>{finding.fix}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <Button onClick={() => openInApp({ fields: [{ name: 'Task', content: text }] })}>Save to my library</Button>
          </div>
        </>
      )}
    </>
  );
}
