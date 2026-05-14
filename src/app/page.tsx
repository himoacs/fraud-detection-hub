'use client';

import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { MetricCard } from '@/components/ui/MetricCard';
import { SimulatorControls } from '@/components/ui/SimulatorControls';
import { TransactionFeed } from '@/components/ui/TransactionFeed';
import { AlertCard } from '@/components/ui/AlertCard';
import { ChatBubble } from '@/components/ui/ChatBubble';
import { ThroughputChart } from '@/components/charts/ThroughputChart';
import { RiskDistributionChart } from '@/components/charts/RiskDistributionChart';
import { AgentActivityPanel } from '@/components/ui/AgentActivityPanel';
import { Toast } from '@/components/ui/Toast';
import { useSimulatorSAM } from '@/hooks/useSimulatorSAM';
import type { FraudPattern } from '@/types';

export default function Dashboard() {
  const {
    connected,
    simulatorState,
    transactions,
    alerts,
    throughputData,
    metrics,
    avgLatency,
    topicFilter,
    setTopicFilter,
    start,
    stop,
    pause,
    resume,
    setRate,
    setFraudRate,
    injectFraud,
  } = useSimulatorSAM();

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);

  const handleInjectFraud = useCallback((pattern: FraudPattern) => {
    injectFraud(pattern);
    const patternNames: Record<FraudPattern, string> = {
      card_testing: 'Card Testing',
      account_takeover: 'Account Takeover',
      velocity_abuse: 'Velocity Abuse',
      geo_anomaly: 'Geo Anomaly',
      amount_spike: 'Amount Spike',
    };
    setToast({ message: `Injected ${patternNames[pattern]} pattern`, type: 'warning' });
  }, [injectFraud]);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header connected={connected} />

      <main className="max-w-[1800px] mx-auto p-6">
        {/* Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
          <MetricCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
            label="Transactions/sec"
            value={simulatorState.running ? simulatorState.ratePerSecond : 0}
            accent="green"
          />
          <MetricCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
            label="Total Processed"
            value={metrics.totalTransactions.toLocaleString()}
            accent="neutral"
          />
          <MetricCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            label="High Risk (≥70)"
            value={metrics.fraudDetected.toLocaleString()}
            accent="red"
            tooltip="Transactions with risk score ≥ 70 flagged for review or blocking"
          />
          <MetricCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            }
            label="Blocked (≥80)"
            value={metrics.fraudBlocked.toLocaleString()}
            accent="green"
            tooltip="Transactions with risk score ≥ 80 automatically blocked"
          />
          <MetricCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            label="Avg Latency"
            value={avgLatency > 0 ? `${(avgLatency / 1000).toFixed(1)}s` : '—'}
            accent="neutral"
            tooltip="Average time for AI scoring via Solace Agent Mesh"
          />
          <MetricCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
            label="Block Rate"
            value={`${metrics.blockRate}%`}
            accent="green"
            tooltip="Percentage of high-risk transactions that were blocked"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - Charts */}
          <div className="lg:col-span-8 space-y-6">
            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ThroughputChart data={throughputData} />
              <RiskDistributionChart transactions={transactions} />
            </div>

            {/* Transaction Feed */}
            <div className="h-[500px]">
              <TransactionFeed 
                transactions={transactions} 
                maxItems={15}
                topicFilter={topicFilter}
                onTopicChange={setTopicFilter}
              />
            </div>
          </div>

          {/* Right Column - Controls & Alerts */}
          <div className="lg:col-span-4 space-y-6">
            {/* SAM Agents Panel */}
            <AgentActivityPanel 
              transactions={transactions} 
              alerts={alerts}
              connected={connected}
            />

            {/* Simulator Controls */}
            <SimulatorControls
              simulatorState={simulatorState}
              onStart={start}
              onStop={stop}
              onPause={pause}
              onResume={resume}
              onRateChange={setRate}
              onFraudRateChange={setFraudRate}
              onInject={handleInjectFraud}
            />

            {/* Alerts */}
            <div className="bg-[var(--background-secondary)] rounded-2xl border border-[var(--border)] p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-white">Real-Time Alerts</h3>
                <span className="text-sm text-[var(--foreground-secondary)]">
                  {alerts.length} active
                </span>
              </div>
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {alerts.length === 0 ? (
                  <p className="text-[var(--foreground-secondary)] text-sm text-center py-8">
                    No alerts yet
                  </p>
                ) : (
                  alerts.map((alert) => (
                    <AlertCard key={alert.id} alert={alert} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 pt-6 border-t border-[var(--border)] text-center text-sm text-[var(--foreground-secondary)]">
          <span>Powered by </span>
          <span className="text-[var(--solace-green)] font-semibold">Solace Agent Mesh</span>
        </footer>
      </main>

      {/* SAM Chat Assistant */}
      <ChatBubble />

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
