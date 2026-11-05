import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './primitives.module.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** Render an accessible icon control with a consistent hit target and focus ring. */
export function IconButton({ label, children, className = '', ...attributes }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${styles.iconButton} ${className}`}
      {...attributes}
    >
      {children}
    </button>
  );
}
