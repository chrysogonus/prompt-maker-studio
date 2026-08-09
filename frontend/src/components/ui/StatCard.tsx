'use client';

import styles from './StatCard.module.css';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'accent' | 'neutral';
}

export default function StatCard({ label, value, hint, hintTone = 'neutral' }: StatCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {hint && (
        <div className={hintTone === 'accent' ? styles.hintAccent : styles.hint}>{hint}</div>
      )}
    </div>
  );
}
