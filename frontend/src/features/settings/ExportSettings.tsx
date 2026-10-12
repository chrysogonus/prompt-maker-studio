import Button from '@/components/ui/Button';

import { DownloadIcon } from '@/components/ui/icon';
import styles from './SettingsPage.module.css';
import type { useSettings } from './useSettings';

type Props = Pick<
  ReturnType<typeof useSettings>,
  | 'isExporting'
  | 'exportError'
  | 'exportSuccess'
  | 'handleExport'
>;

export function ExportSettings({
  isExporting,
  exportError,
  exportSuccess,
  handleExport,
}: Props) {
  return (
    <section className={styles.section} id="s-data" aria-labelledby="h-data">
      <div className={styles.intro}>
        <h2 id="h-data">Your data</h2>
      </div>
      <div className={styles.body}>
        <p className={styles.text}>
          Download every prompt with its folders and full version history as a JSON file.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
            <DownloadIcon size={16} tone="inherit" />
            {isExporting ? 'Exporting…' : 'Export all prompts'}
          </Button>
        </div>
        {exportError && <div className={styles.error}>{exportError}</div>}
        {exportSuccess && <div className={styles.success}>{exportSuccess}</div>}
      </div>
    </section>
  );
}
