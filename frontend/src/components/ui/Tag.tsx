'use client';

import { HTMLAttributes } from 'react';
import { RemoveIcon } from './icon';
import Tooltip from './Tooltip';
import styles from './Tag.module.css';

type TagVariant = 'neutral' | 'accent' | 'success' | 'outline';

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant;
  onRemove?: () => void;
}

export default function Tag({ variant = 'neutral', className, children, onRemove, ...rest }: TagProps) {
  const classes = [styles.tag, styles[variant], className].filter(Boolean).join(' ');
  const removeLabel = `Remove tag${typeof children === 'string' ? ` ${children}` : ''}`;

  return (
    <span className={classes} {...rest}>
      {children}
      {onRemove && (
        <Tooltip content={removeLabel} className={styles.removeControl}>
          <button
            type="button"
            className={styles.remove}
            aria-label={removeLabel}
            onClick={onRemove}
          >
            <RemoveIcon size="xs" tone="inherit" />
          </button>
        </Tooltip>
      )}
    </span>
  );
}
