'use client';

import { ReactNode, useState } from 'react';

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  change?: { value: string; positive: boolean };
  accent?: 'green' | 'red' | 'amber' | 'neutral';
  tooltip?: string;
}

export function MetricCard({ icon, label, value, change, accent = 'green', tooltip }: MetricCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const accentColors = {
    green: 'border-[var(--solace-green)]/20 hover:border-[var(--solace-green)]/40',
    red: 'border-[var(--danger)]/20 hover:border-[var(--danger)]/40',
    amber: 'border-[var(--warning)]/20 hover:border-[var(--warning)]/40',
    neutral: 'border-[var(--border)] hover:border-[var(--border-light)]',
  };

  const iconColors = {
    green: 'text-[var(--solace-green)] bg-[var(--solace-green)]/10',
    red: 'text-[var(--danger)] bg-[var(--danger)]/10',
    amber: 'text-[var(--warning)] bg-[var(--warning)]/10',
    neutral: 'text-[var(--foreground-secondary)] bg-[var(--background-elevated)]',
  };

  return (
    <div
      className={`
        bg-[var(--background-secondary)] rounded-2xl p-6
        border transition-all duration-200 relative
        ${accentColors[accent]}
      `}
      onMouseEnter={() => tooltip && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Tooltip */}
      {tooltip && showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[var(--background-elevated)] border border-[var(--border)] rounded-lg shadow-lg z-10 w-48 text-center">
          <div className="text-xs text-[var(--foreground-secondary)]">{tooltip}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-[var(--background-elevated)]" />
        </div>
      )}

      {/* Icon */}
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${iconColors[accent]}`}
      >
        {icon}
      </div>

      {/* Label */}
      <div className="text-[var(--foreground-secondary)] text-sm font-medium mb-1">
        {label}
      </div>

      {/* Value */}
      <div className="text-3xl font-semibold text-white tracking-tight">
        {value}
      </div>

      {/* Change indicator */}
      {change && (
        <div
          className={`mt-2 text-sm flex items-center gap-1 ${
            change.positive ? 'text-[var(--solace-green)]' : 'text-[var(--danger)]'
          }`}
        >
          <span>{change.positive ? '↑' : '↓'}</span>
          <span>{change.value}</span>
        </div>
      )}
    </div>
  );
}
