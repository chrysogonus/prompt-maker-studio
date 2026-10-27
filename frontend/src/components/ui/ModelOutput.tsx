'use client';

import { useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ModelOutput.module.css';

// Model output is untrusted. Raw HTML stays out (no rehype-raw), links open away from the
// app, and images become their alt text so an answer cannot load remote content.
const COMPONENTS: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }) => <>{alt}</>,
  // Wide tables scroll on their own, reachable by keyboard.
  table: ({ children }) => (
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Table">
      <table>{children}</table>
    </div>
  ),
};

/** A model's answer rendered as Markdown, with the exact text one toggle away. */
export default function ModelOutput({ text, label = 'Model output' }: { text: string; label?: string }) {
  const [plain, setPlain] = useState(false);
  return (
    <div className={styles.output}>
      <button type="button" className={styles.toggle} aria-pressed={plain} onClick={() => setPlain((value) => !value)}>
        Plain text
      </button>
      {plain ? (
        <pre className={styles.plain} tabIndex={0} aria-label={label}>{text}</pre>
      ) : (
        <div className={styles.formatted} tabIndex={0} role="region" aria-label={label}>
          <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
