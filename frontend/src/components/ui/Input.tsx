'use client';

import { InputHTMLAttributes, forwardRef } from 'react';
import styles from './Input.module.css';

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    const classes = [styles.input, className].filter(Boolean).join(' ');
    return <input ref={ref} className={classes} {...rest} />;
  }
);

export default Input;
