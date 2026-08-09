'use client';

import Link from 'next/link';
import { ButtonHTMLAttributes, ComponentPropsWithoutRef, forwardRef } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export interface ButtonLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  variant?: ButtonVariant;
}

function buttonClassName(variant: ButtonVariant, className?: string): string {
  return [styles.button, styles[variant], className].filter(Boolean).join(' ');
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type = 'button', ...rest },
  ref
) {
  return <button ref={ref} type={type} className={buttonClassName(variant, className)} {...rest} />;
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = 'secondary', className, ...rest },
  ref
) {
  return <Link ref={ref} className={buttonClassName(variant, className)} {...rest} />;
});

export default Button;
