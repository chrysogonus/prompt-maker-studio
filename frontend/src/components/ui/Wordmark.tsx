import { APP_NAME } from '@/lib/branding';
import { PromptMakerMark, PromptMakerTile } from '@/components/brand/PromptMakerMark';
import styles from './Wordmark.module.css';

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
      <span>{APP_NAME}</span>
    </span>
  );
}
