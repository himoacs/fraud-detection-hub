'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const variants = {
    primary: `
      bg-[var(--solace-green)] hover:bg-[var(--solace-green-dark)]
      text-[var(--background)] font-medium
    `,
    secondary: `
      bg-[var(--background-elevated)] hover:bg-[var(--background-elevated)]/80
      border border-[var(--border)] hover:border-[var(--solace-green)]/50
      text-white
    `,
    ghost: `
      bg-transparent hover:bg-[var(--background-elevated)]
      text-[var(--foreground-secondary)] hover:text-white
    `,
    danger: `
      bg-[var(--danger)] hover:bg-[var(--danger)]/90
      text-white font-medium
    `,
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm rounded-lg',
    md: 'px-4 py-2 text-sm rounded-xl',
    lg: 'px-6 py-3 text-base rounded-xl',
  };

  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2
        transition-all duration-200 active:scale-[0.98]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
