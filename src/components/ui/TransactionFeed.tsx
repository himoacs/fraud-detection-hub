'use client';

import { useRef } from 'react';
import type { ScoredTransaction } from '@/types';
import { RiskScore } from './RiskScore';
import { TopicFilter } from './TopicFilter';

interface TransactionFeedProps {
  transactions: ScoredTransaction[];
  maxItems?: number;
  topicFilter: string;
  onTopicChange: (topic: string) => void;
}

// Spinner component for pending transactions
function ProcessingSpinner() {
  return (
    <div className="flex items-center gap-2">
      <svg className="animate-spin h-4 w-4 text-[var(--solace-green)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span className="text-xs text-[var(--foreground-secondary)]">Processing...</span>
    </div>
  );
}

export function TransactionFeed({ transactions, maxItems = 20, topicFilter, onTopicChange }: TransactionFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const displayTransactions = transactions.slice(0, maxItems);

  const getDecisionStyle = (decision: ScoredTransaction['decision'], isPending: boolean) => {
    if (isPending) {
      return 'bg-[var(--solace-green)]/5 text-[var(--solace-green)]/60 border-[var(--solace-green)]/10 animate-pulse';
    }
    switch (decision) {
      case 'approved':
        return 'bg-[var(--solace-green)]/10 text-[var(--solace-green)] border-[var(--solace-green)]/20';
      case 'blocked':
        return 'bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/20';
      case 'review':
        return 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/20';
    }
  };

  // Calculate stats
  const pendingCount = transactions.filter(tx => tx._status === 'pending' || tx.risk_score === -1).length;
  const scoredCount = transactions.length - pendingCount;

  return (
    <div className="bg-[var(--background-secondary)] rounded-2xl border border-[var(--border)] overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-white">Live Transactions</h3>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span className="text-xs text-[var(--solace-green)] flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {pendingCount} scoring
              </span>
            )}
            <span className="text-sm text-[var(--foreground-secondary)]">
              {scoredCount} scored
            </span>
          </div>
        </div>
        
        {/* Topic Filter - Demonstrates Solace wildcard subscriptions */}
        <TopicFilter
          currentTopic={topicFilter}
          onTopicChange={onTopicChange}
          transactionCount={transactions.length}
        />
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {displayTransactions.length === 0 ? (
          <div className="p-8 text-center text-[var(--foreground-secondary)]">
            Start the simulator to see transactions
          </div>
        ) : (
          displayTransactions.map((tx) => {
            const isPending = tx._status === 'pending' || tx.risk_score === -1;
            
            return (
              <div
                key={tx.transaction_id}
                className={`p-4 hover:bg-[var(--background-elevated)] transition-colors animate-slide-in ${isPending ? 'opacity-80' : ''}`}
              >
                <div className="flex items-center justify-between gap-4">
                  {/* Merchant + ID + Topic */}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-white truncate">
                      {tx.merchant?.name || 'Unknown Merchant'}
                    </div>
                    <div className="text-xs text-[var(--foreground-secondary)] font-mono truncate">
                      {tx.transaction_id}
                    </div>
                    <div className="text-[10px] text-[var(--solace-green)]/60 font-mono truncate" title={tx._topic}>
                      {tx._topic || `solace/fraud/v1/transactions/inbound/${tx.merchant?.country || 'XX'}/${tx.type || 'unknown'}`}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right">
                    <div className="font-semibold text-white">
                      ${(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-[var(--foreground-secondary)] uppercase">
                      {(tx.type || 'unknown').replace('_', ' ')}
                    </div>
                  </div>

                  {/* Risk Score or Processing Spinner */}
                  <div className="w-24">
                    {isPending ? (
                      <ProcessingSpinner />
                    ) : (
                      <RiskScore score={tx.risk_score} showBar={true} />
                    )}
                  </div>

                  {/* Decision or Pending Badge */}
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border min-w-[70px] text-center ${getDecisionStyle(tx.decision, isPending)}`}
                  >
                    {isPending ? 'pending' : tx.decision}
                  </span>
                </div>
                
                {/* Processing time indicator for scored transactions */}
                {!isPending && tx.processing_time_ms && (
                  <div className="mt-1 text-[10px] text-[var(--foreground-secondary)]">
                    Scored in {(tx.processing_time_ms / 1000).toFixed(1)}s
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
