'use client';

interface RiskScoreProps {
  score: number;
  showBar?: boolean;
}

export function RiskScore({ score, showBar = true }: RiskScoreProps) {
  const getColor = (score: number) => {
    if (score >= 80) return { bar: 'bg-[var(--danger)]', text: 'text-[var(--danger)]' };
    if (score >= 50) return { bar: 'bg-[var(--warning)]', text: 'text-[var(--warning)]' };
    return { bar: 'bg-[var(--solace-green)]', text: 'text-[var(--solace-green)]' };
  };

  const colors = getColor(score);

  return (
    <div className="flex items-center gap-3">
      {showBar && (
        <div className="flex-1 h-1.5 bg-[var(--background-elevated)] rounded-full overflow-hidden">
          <div
            className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
            style={{ width: `${score}%` }}
          />
        </div>
      )}
      <span className={`text-sm font-mono font-medium w-8 text-right ${colors.text}`}>
        {score}
      </span>
    </div>
  );
}
