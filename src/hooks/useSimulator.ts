'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ScoredTransaction, SimulatorState, FraudPattern, Alert } from '@/types';

const initialState: SimulatorState = {
  running: false,
  paused: false,
  ratePerSecond: 5,
  fraudRate: 0.05,
  totalGenerated: 0,
  totalFraud: 0,
  totalBlocked: 0,
  startTime: null,
};

export function useSimulator() {
  const [connected, setConnected] = useState(false);
  const [simulatorState, setSimulatorState] = useState<SimulatorState>(initialState);
  const [transactions, setTransactions] = useState<ScoredTransaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [throughputData, setThroughputData] = useState<{ time: string; txns: number; fraud: number }[]>([]);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const txCountRef = useRef(0);
  const fraudCountRef = useRef(0);

  // Connect to SSE stream
  useEffect(() => {
    const eventSource = new EventSource('/api/simulator/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onerror = () => {
      setConnected(false);
    };

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'connected') {
          setConnected(true);
        } else if (message.type === 'transaction') {
          const tx = message.data as ScoredTransaction;
          
          // Add to transactions (keep last 100)
          setTransactions((prev) => [tx, ...prev].slice(0, 100));
          
          // Track counts for throughput
          txCountRef.current++;
          if (tx._fraud_label) {
            fraudCountRef.current++;
          }

          // Generate alert for high-risk transactions
          if (tx.risk_score >= 70) {
            const alert: Alert = {
              id: tx.transaction_id,
              timestamp: tx.timestamp,
              severity: tx.risk_score >= 85 ? 'critical' : tx.risk_score >= 75 ? 'high' : 'medium',
              headline: `${tx._fraud_pattern?.replace('_', ' ').toUpperCase() || 'Suspicious'} - $${tx.amount.toFixed(2)}`,
              transaction_id: tx.transaction_id,
              score: tx.risk_score,
              pattern: tx._fraud_pattern,
            };
            setAlerts((prev) => [alert, ...prev].slice(0, 20));
          }
        } else if (message.type === 'stats') {
          setSimulatorState(message.data);
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Update throughput data every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (!simulatorState.running) return;

      const now = new Date();
      const timeStr = `${now.getMinutes()}:${now.getSeconds().toString().padStart(2, '0')}`;

      setThroughputData((prev) => {
        const newData = [
          ...prev,
          { time: timeStr, txns: txCountRef.current, fraud: fraudCountRef.current },
        ].slice(-30);

        // Reset counters
        txCountRef.current = 0;
        fraudCountRef.current = 0;

        return newData;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [simulatorState.running]);

  const start = useCallback(async () => {
    const res = await fetch('/api/simulator/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fraudRate: simulatorState.fraudRate }),
    });
    const data = await res.json();
    if (data.success) {
      setSimulatorState(data.state);
    }
  }, [simulatorState.fraudRate]);

  const stop = useCallback(async () => {
    const res = await fetch('/api/simulator/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setSimulatorState(data.state);
    }
  }, []);

  const pause = useCallback(async () => {
    const res = await fetch('/api/simulator/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    const data = await res.json();
    if (data.success) {
      setSimulatorState(data.state);
    }
  }, []);

  const resume = useCallback(async () => {
    const res = await fetch('/api/simulator/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });
    const data = await res.json();
    if (data.success) {
      setSimulatorState(data.state);
    }
  }, []);

  const setRate = useCallback(async (rate: number) => {
    const res = await fetch('/api/simulator/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate }),
    });
    const data = await res.json();
    if (data.success) {
      setSimulatorState(data.state);
    }
  }, []);

  const setFraudRate = useCallback(async (fraudRate: number) => {
    const res = await fetch('/api/simulator/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fraudRate }),
    });
    const data = await res.json();
    if (data.success) {
      setSimulatorState(data.state);
    }
  }, []);

  const injectFraud = useCallback(async (pattern: FraudPattern) => {
    await fetch('/api/simulator/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, count: 1 }),
    });
  }, []);

  // Calculate metrics
  const metrics = {
    totalTransactions: simulatorState.totalGenerated,
    fraudDetected: simulatorState.totalFraud,
    fraudBlocked: simulatorState.totalBlocked,
    avgRiskScore: transactions.length > 0
      ? Math.round(transactions.reduce((sum, tx) => sum + tx.risk_score, 0) / transactions.length)
      : 0,
    blockRate: simulatorState.totalFraud > 0
      ? Math.round((simulatorState.totalBlocked / simulatorState.totalFraud) * 100)
      : 0,
  };

  return {
    connected,
    simulatorState,
    transactions,
    alerts,
    throughputData,
    metrics,
    start,
    stop,
    pause,
    resume,
    setRate,
    setFraudRate,
    injectFraud,
  };
}
