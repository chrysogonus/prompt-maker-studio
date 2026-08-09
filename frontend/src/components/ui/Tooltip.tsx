'use client';

import { cloneElement, useId } from 'react';
import type { ReactElement } from 'react';
import styles from './Tooltip.module.css';

interface TooltipChildProps {
  'aria-describedby'?: string;
}

interface TooltipProps {
  content: string;
  children: ReactElement<TooltipChildProps>;
  className?: string;
}

export default function Tooltip({ content, children, className }: TooltipProps) {
  const classes = [styles.wrapper, className].filter(Boolean).join(' ');
  const tooltipId = useId();
  const describedBy = [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span id={tooltipId} className={styles.content} role="tooltip">
        {content}
      </span>
    </span>
  );
}
