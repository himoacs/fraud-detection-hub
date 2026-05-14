'use client';

import { useState, useEffect, useRef } from 'react';

interface AgentActivityPanelProps {
  transactions: any[];
  alerts: any[];
  connected?: boolean;
}

// SAM Agents registered with the Orchestrator (receive work via A2A, not topic subscriptions)
const AGENTS = [
  { 
    name: 'FraudTransactionScorer', 
    shortName: 'Scorer',
    description: 'AI risk scoring',
    color: 'var(--solace-green)',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )
  },
  { 
    name: 'FraudAlertGenerator', 
    shortName: 'Alerts',
    description: 'Alert generation',
    color: '#f97316',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    )
  },
  { 
    name: 'FraudMetricsAggregator', 
    shortName: 'Metrics',
    description: 'Analytics',
    color: '#22d3ee',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
    )
  },
];

interface AgentStat {
  count: number;
  active: boolean;
  lastActive?: number;
}

export function AgentActivityPanel({ transactions, alerts, connected = false }: AgentActivityPanelProps) {
  const [agentStats, setAgentStats] = useState<Record<string, AgentStat>>({
    'FraudTransactionScorer': { count: 0, active: false },
    'FraudAlertGenerator': { count: 0, active: false },
    'FraudMetricsAggregator': { count: 0, active: false },
  });
  
  const prevScoredCountRef = useRef(0);
  const prevAlertCountRef = useRef(0);

  // Track scored transactions (when risk_score is set, scorer was invoked by orchestrator)
  useEffect(() => {
    const scoredCount = transactions.filter(tx => tx._status === 'scored' || (tx.risk_score !== undefined && tx.risk_score >= 0)).length;
    const alertCount = alerts.length;
    
    const scorerActive = scoredCount > prevScoredCountRef.current;
    const alertsActive = alertCount > prevAlertCountRef.current;
    
    prevScoredCountRef.current = scoredCount;
    prevAlertCountRef.current = alertCount;
    
    setAgentStats(prev => ({
      'FraudTransactionScorer': { 
        count: scoredCount, 
        active: scorerActive,
        lastActive: scorerActive ? Date.now() : prev['FraudTransactionScorer'].lastActive
      },
      'FraudAlertGenerator': { 
        count: alertCount, 
        active: alertsActive,
        lastActive: alertsActive ? Date.now() : prev['FraudAlertGenerator'].lastActive
      },
      'FraudMetricsAggregator': { 
        count: scoredCount, 
        active: scorerActive,
        lastActive: scorerActive ? Date.now() : prev['FraudMetricsAggregator'].lastActive
      },
    }));
  }, [transactions, alerts]);

  // Reset active state after animation
  useEffect(() => {
    const hasActive = Object.values(agentStats).some(s => s.active);
    if (!hasActive) return;
    
    const timeout = setTimeout(() => {
      setAgentStats(prev => ({
        'FraudTransactionScorer': { ...prev['FraudTransactionScorer'], active: false },
        'FraudAlertGenerator': { ...prev['FraudAlertGenerator'], active: false },
        'FraudMetricsAggregator': { ...prev['FraudMetricsAggregator'], active: false },
      }));
    }, 500);
    return () => clearTimeout(timeout);
  }, [agentStats]);

  // Format last active time
  const formatLastActive = (timestamp?: number) => {
    if (!timestamp) return 'idle';
    const diff = Date.now() - timestamp;
    if (diff < 2000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    return `${Math.floor(diff / 60000)}m ago`;
  };

  return (
    <div className="bg-[var(--background-secondary)] rounded-2xl border border-[var(--border)] p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-white">SAM Agents</h3>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--solace-green)] animate-pulse' : 'bg-[var(--foreground-muted)]'}`} />
          <span className="text-[10px] text-[var(--foreground-secondary)]">
            {connected ? 'Orchestrator' : 'Waiting...'}
          </span>
        </div>
      </div>
      
      {/* Architecture note */}
      <p className="text-[10px] text-[var(--foreground-muted)] mb-4">
        Agents receive work from Orchestrator via A2A protocol
      </p>

      {/* Agent Cards */}
      <div className="space-y-2">
        {AGENTS.map((agent) => {
          const stats = agentStats[agent.name];
          const isRegistered = connected;
          
          return (
            <div
              key={agent.name}
              className={`
                flex items-center gap-3 p-3 rounded-xl 
                bg-[var(--background)] border border-[var(--border)]
                transition-all duration-200
                ${stats?.active ? 'border-[var(--solace-green)]/50 shadow-[0_0_12px_rgba(0,200,149,0.15)]' : ''}
              `}
            >
              <div 
                className={`
                  w-7 h-7 rounded-lg flex items-center justify-center
                  transition-colors duration-200
                `}
                style={{ 
                  backgroundColor: stats?.active ? `color-mix(in srgb, ${agent.color} 20%, transparent)` : 'var(--background-elevated)',
                  color: stats?.active ? agent.color : 'var(--foreground-muted)'
                }}
              >
                {agent.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{agent.shortName}</span>
                  {isRegistered ? (
                    <span className="px-1.5 py-0.5 text-[8px] bg-[var(--solace-green)]/10 text-[var(--solace-green)] rounded border border-[var(--solace-green)]/20">
                      registered
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 text-[8px] bg-[var(--foreground-muted)]/10 text-[var(--foreground-muted)] rounded">
                      offline
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--foreground-muted)]">
                  {stats?.count > 0 ? formatLastActive(stats?.lastActive) : 'no activity'}
                </div>
              </div>
              <div className="text-right">
                <div 
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: stats?.count > 0 ? agent.color : 'var(--foreground-muted)' }}
                >
                  {stats?.count || 0}
                </div>
                <div className="text-[9px] text-[var(--foreground-muted)]">
                  processed
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
