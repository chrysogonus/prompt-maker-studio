'use client';

import { SelectHTMLAttributes, forwardRef } from 'react';
import styles from './Select.module.css';

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    const classes = [styles.select, className].filter(Boolean).join(' ');
    return (
      <select ref={ref} className={classes} {...rest}>
        {children}
      </select>
    );
  }
);

export default Select;
