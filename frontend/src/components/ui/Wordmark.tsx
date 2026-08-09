import { APP_NAME } from '@/lib/branding';
import { PromptMakerMark, PromptMakerTile } from '@/components/brand/PromptMakerMark';
import styles from './Wordmark.module.css';

// The last word carries the accent colour. Deriving it from APP_NAME rather
// than hardcoding "Studio" keeps the wordmark correct through a future rename.
const lastSpace = APP_NAME.lastIndexOf(' ');
const LEAD = APP_NAME.slice(0, lastSpace);
const ACCENT = APP_NAME.slice(lastSpace + 1);

interface WordmarkProps {
  /** Tile for the auth hero, standalone mark for the app header. */
  icon?: 'mark' | 'tile';
  /** Host-supplied class for sizing and layout, so each surface keeps its own scale. */
  className?: string;
}

export default function Wordmark({ icon, className }: WordmarkProps) {
  return (
    <span className={[styles.wordmark, className].filter(Boolean).join(' ')}>
      {icon === 'mark' && (
        <PromptMakerMark size={28} className={styles.mark} decorative />
      )}
      {icon === 'tile' && <PromptMakerTile className={styles.tile} />}
      <span>
        {LEAD} <span className={styles.accent}>{ACCENT}</span>
      </span>
    </span>
  );
}
