/**
 * Shared advisory readiness panel — renders the deterministic checks from
 * `lib/preflight.ts`. Used at the copy (OutputPanel), Playground, and
 * Evaluate entry points so authors see the same warnings everywhere.
 * Purely informational: renders nothing when there are no warnings, and
 * never disables the action it sits next to.
 */

import { PreflightWarning } from '@/lib/preflight';
import styles from './PreflightPanel.module.css';

interface PreflightPanelProps {
  warnings: PreflightWarning[];
}

export default function PreflightPanel({ warnings }: PreflightPanelProps) {
  if (warnings.length === 0) return null;

  return (
    <div className={styles.panel} aria-label="Preflight checks">
      <div className={styles.title}>Preflight checks</div>
      <ul className={styles.list}>
        {warnings.map((warning) => (
          <li key={warning.id} className={styles.item} data-severity={warning.severity}>
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
