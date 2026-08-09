'use client';

import { TextareaHTMLAttributes, forwardRef } from 'react';
import styles from './Textarea.module.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, mono = false, ...rest },
  ref
) {
  const classes = [styles.textarea, mono && styles.mono, className].filter(Boolean).join(' ');
  return <textarea ref={ref} className={classes} {...rest} />;
});

export default Textarea;
