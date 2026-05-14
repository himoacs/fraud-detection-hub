'use client';

import type { Alert } from '@/types';

interface AlertCardProps {
  alert: Alert;
  onClick?: () => void;
}

export function AlertCard({ alert, onClick }: AlertCardProps) {
  const config = {
    critical: { 
      dot: 'bg-[var(--danger)]', 
      bg: 'bg-[var(--danger)]/5', 
      border: 'border-[var(--danger)]/20',
      pulse: true
    },
    high: { 
      dot: 'bg-orange-500', 
      bg: 'bg-orange-500/5', 
      border: 'border-orange-500/20',
      pulse: false
    },
    medium: { 
      dot: 'bg-[var(--warning)]', 
      bg: 'bg-[var(--warning)]/5', 
      border: 'border-[var(--warning)]/20',
      pulse: false
    },
    low: { 
      dot: 'bg-[var(--solace-green)]', 
      bg: 'bg-[var(--solace-green)]/5', 
      border: 'border-[var(--solace-green)]/20',
      pulse: false
    },
  };

  const styles = config[alert.severity];

  const getTimeAgo = (timestamp: string) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  return (
    <div
      onClick={onClick}
      className={`
        ${styles.bg} ${styles.border}
        border rounded-xl p-4 cursor-pointer
        transition-all duration-200 hover:scale-[1.01]
        ${styles.pulse ? 'animate-pulse-slow' : ''}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-1.5 ${styles.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate">{alert.headline}</div>
          <div className="text-sm text-[var(--foreground-secondary)] mt-0.5 truncate">
            {alert.transaction_id} · Score {alert.score} · {getTimeAgo(alert.timestamp)}
          </div>
        </div>
      </div>
    </div>
  );
}
