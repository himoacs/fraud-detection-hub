'use client';

import { useState, useEffect } from 'react';
import { Button } from './Button';
import type { FraudPattern, SimulatorState } from '@/types';

interface DemoControlsProps {
  simulatorState: SimulatorState;
  mode?: 'demo' | 'sam';
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRateChange: (rate: number) => void;
  onFraudRateChange: (rate: number) => void;
  onInject: (pattern: FraudPattern) => void;
}

// SVG icons for fraud patterns (brand-consistent line icons)
const FraudIcons = {
  card_testing: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  account_takeover: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  ),
  velocity_abuse: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  geo_anomaly: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  amount_spike: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
};

const FRAUD_PATTERNS: { id: FraudPattern; label: string }[] = [
  { id: 'card_testing', label: 'Card Testing' },
  { id: 'account_takeover', label: 'Account Takeover' },
  { id: 'velocity_abuse', label: 'Velocity Abuse' },
  { id: 'geo_anomaly', label: 'Geo Anomaly' },
  { id: 'amount_spike', label: 'Amount Spike' },
];

export function DemoControls({
  simulatorState,
  mode = 'demo',
  onStart,
  onStop,
  onPause,
  onResume,
  onRateChange,
  onFraudRateChange,
  onInject,
}: DemoControlsProps) {
  // SAM mode has lower rate limits due to LLM processing time (~5s per transaction)
  const isSamMode = mode === 'sam';
  const minRate = isSamMode ? 0.5 : 10;
  const maxRate = isSamMode ? 10 : 1000;
  const defaultRate = isSamMode ? 1 : 100;
  
  const [localRate, setLocalRate] = useState(Math.min(Math.max(simulatorState.ratePerSecond, minRate), maxRate));
  const [localFraudRate, setLocalFraudRate] = useState(simulatorState.fraudRate * 100);
  
  // Update local rate when mode changes
  useEffect(() => {
    setLocalRate(Math.min(Math.max(simulatorState.ratePerSecond, minRate), maxRate));
  }, [mode, minRate, maxRate, simulatorState.ratePerSecond]);

  const handleRateChange = (value: number) => {
    setLocalRate(value);
    onRateChange(value);
  };

  const handleFraudRateChange = (value: number) => {
    setLocalFraudRate(value);
    onFraudRateChange(value / 100);
  };

  return (
    <div className="bg-[var(--background-secondary)] rounded-2xl border border-[var(--border)] p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-white">Demo Controls</h3>
        {isSamMode && (
          <span className="px-2 py-1 rounded-full text-[10px] font-medium bg-[var(--solace-green)]/10 text-[var(--solace-green)] border border-[var(--solace-green)]/20">
            SAM Mode
          </span>
        )}
      </div>
      
      {/* SAM Mode Info Banner */}
      {isSamMode && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--solace-green)]/5 border border-[var(--solace-green)]/10">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 text-[var(--solace-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div className="text-xs font-medium text-[var(--solace-green)]">LLM-Powered Scoring</div>
              <div className="text-[10px] text-[var(--foreground-secondary)]">
                Transactions processed by SAM agents (~5s latency). Raw data shown immediately.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Simulator Controls */}
      <div className="mb-6 space-y-4">
        <div className="flex items-center gap-3">
          {!simulatorState.running ? (
            <Button onClick={onStart} className="flex-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
              Start
            </Button>
          ) : (
            <>
              {simulatorState.paused ? (
                <Button onClick={onResume} className="flex-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                  Resume
                </Button>
              ) : (
                <Button onClick={onPause} variant="secondary" className="flex-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zm7 0a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                  </svg>
                  Pause
                </Button>
              )}
              <Button onClick={onStop} variant="danger">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5.25 3A2.25 2.25 0 003 5.25v9.5A2.25 2.25 0 005.25 18h9.5A2.25 2.25 0 0017 15.75v-9.5A2.25 2.25 0 0014.75 3h-9.5z" />
                </svg>
                Stop
              </Button>
            </>
          )}
        </div>

        {/* Stats */}
        {simulatorState.running && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-[var(--background-elevated)] rounded-lg p-3">
              <div className="text-xl font-semibold text-white">
                {simulatorState.totalGenerated.toLocaleString()}
              </div>
              <div className="text-xs text-[var(--foreground-secondary)]">Generated</div>
            </div>
            <div className="bg-[var(--background-elevated)] rounded-lg p-3">
              <div className="text-xl font-semibold text-[var(--danger)]">
                {simulatorState.totalFraud.toLocaleString()}
              </div>
              <div className="text-xs text-[var(--foreground-secondary)]">Fraud</div>
            </div>
            <div className="bg-[var(--background-elevated)] rounded-lg p-3">
              <div className="text-xl font-semibold text-[var(--solace-green)]">
                {simulatorState.totalBlocked.toLocaleString()}
              </div>
              <div className="text-xs text-[var(--foreground-secondary)]">Blocked</div>
            </div>
          </div>
        )}
      </div>

      {/* Rate Slider */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[var(--foreground-secondary)]">Transaction Rate</span>
          <span className="text-sm font-mono text-white">
            {localRate < 1 ? localRate.toFixed(1) : Math.round(localRate)}/sec
          </span>
        </div>
        <input
          type="range"
          min={minRate}
          max={maxRate}
          step={isSamMode ? 0.5 : 10}
          value={localRate}
          onChange={(e) => handleRateChange(Number(e.target.value))}
          className="w-full h-2 bg-[var(--background-elevated)] rounded-lg appearance-none cursor-pointer accent-[var(--solace-green)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--foreground-secondary)] mt-1">
          <span>{minRate}/s</span>
          <span>{maxRate}/s</span>
        </div>
      </div>

      {/* Fraud Rate Slider */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[var(--foreground-secondary)]">Fraud Rate</span>
          <span className="text-sm font-mono text-white">{localFraudRate.toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={localFraudRate}
          onChange={(e) => handleFraudRateChange(Number(e.target.value))}
          className="w-full h-2 bg-[var(--background-elevated)] rounded-lg appearance-none cursor-pointer accent-[var(--warning)]"
        />
      </div>

      {/* Fraud Injection */}
      <div>
        <div className="text-sm text-[var(--foreground-secondary)] mb-3">Inject Fraud Pattern</div>
        <div className="grid grid-cols-2 gap-2">
          {FRAUD_PATTERNS.map((pattern) => (
            <Button
              key={pattern.id}
              variant="secondary"
              size="sm"
              onClick={() => onInject(pattern.id)}
              disabled={!simulatorState.running}
              className="justify-start"
            >
              {FraudIcons[pattern.id]}
              <span className="truncate">{pattern.label}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
