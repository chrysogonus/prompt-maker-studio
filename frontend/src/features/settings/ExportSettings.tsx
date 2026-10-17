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
          Download a data archive with every prompt, its folders and full version history as JSON.
          Library import creates copies of current prompts; it does not restore original history,
          dates, notes or favorites. Keep the archive for your complete records.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
            <DownloadIcon size={16} tone="inherit" />
            {isExporting ? 'Exporting…' : 'Export data archive'}
          </Button>
        </div>
        {exportError && <div className={styles.error}>{exportError}</div>}
        {exportSuccess && <div className={styles.success}>{exportSuccess}</div>}
      </div>
    </section>
  );
}
