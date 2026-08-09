'use client';

import { HTMLAttributes, KeyboardEvent, MouseEvent } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export default function Card({
  className,
  interactive = false,
  onClick,
  onKeyDown,
  ...rest
}: CardProps) {
  const classes = [styles.card, interactive && styles.interactive, className]
    .filter(Boolean)
    .join(' ');

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    // Only activate for a key press on the card itself, not one that bubbled
    // up from a nested interactive element (e.g. a favorite/action button).
    if (interactive && onClick && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick(e as unknown as MouseEvent<HTMLDivElement>);
    }
  };

  return (
    <div
      className={classes}
      onClick={onClick}
      onKeyDown={interactive ? handleKeyDown : onKeyDown}
      role={interactive && onClick ? 'button' : undefined}
      tabIndex={interactive && onClick ? 0 : undefined}
      {...rest}
    />
  );
}
