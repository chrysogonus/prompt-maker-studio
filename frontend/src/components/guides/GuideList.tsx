import Link from 'next/link';
import { GUIDES } from '@/lib/guides';
import styles from './Guides.module.css';

export default function GuideList({ exclude }: { exclude?: string }) {
  return (
    <ul className={styles.guideList}>
      {Object.values(GUIDES).filter((guide) => guide.path !== exclude).map((guide) => (
        <li key={guide.path}>
          <Link href={guide.path}>{guide.title}</Link>
          <p>{guide.description}</p>
        </li>
      ))}
    </ul>
  );
}
