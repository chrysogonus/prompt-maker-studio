'use client';

import styles from './StarRating.module.css';

interface StarRatingProps {
  onRate: (stars: number) => void;
  disabled?: boolean;
}

export default function StarRating({ onRate, disabled = false }: StarRatingProps) {
  return (
    <div className={styles.stars} role="group" aria-label="Rate this result">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={styles.star}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          disabled={disabled}
          onClick={() => onRate(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}
