'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ScoredTransaction, SimulatorState, FraudPattern, Alert, Transaction } from '@/types';

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

// Always use SAM mode - no demo fallback
const MODE = 'sam' as const;

export function useSimulatorSAM() {
  // Always SAM mode - no demo fallback
  const [connected, setConnected] = useState(false);
  const [solaceConnected, setSolaceConnected] = useState(false);
  const [simulatorState, setSimulatorState] = useState<SimulatorState>(initialState);
  const [transactions, setTransactions] = useState<ScoredTransaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [throughputData, setThroughputData] = useState<{ time: string; txns: number; fraud: number }[]>([]);
  const [avgLatency, setAvgLatency] = useState<number>(0);
  
  // Topic filter for dynamic Solace subscription
  const [topicFilter, setTopicFilterState] = useState('solace/fraud/v1/transactions/inbound/>');
  const currentRawTopicRef = useRef('solace/fraud/v1/transactions/inbound/>');
  const rawCallbackRef = useRef<((message: any) => void) | null>(null);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const solaceClientRef = useRef<any>(null);
  const txCountRef = useRef(0);
  const fraudCountRef = useRef(0);
  const latencyHistoryRef = useRef<number[]>([]);
  
  // Track pending transactions by ID
  const pendingTxMapRef = useRef<Map<string, number>>(new Map());

  // Process incoming raw transaction (SAM mode) - show immediately with pending status
  const processRawTransaction = useCallback((tx: Transaction, topic?: string) => {
    const now = Date.now();
    pendingTxMapRef.current.set(tx.transaction_id, now);
    
    // Create a pending transaction (partial ScoredTransaction)
    const pendingTx: ScoredTransaction = {
      ...tx,
      risk_score: -1, // Indicates pending
      confidence: 0,
      decision: 'review', // Default until scored
      _status: 'pending',
      _received_at: now,
      _topic: topic, // Store actual Solace topic
    };
    
    setTransactions((prev) => [pendingTx, ...prev].slice(0, 100));
    txCountRef.current++;
    
    console.log('[useSimulatorSAM] Raw transaction received:', tx.transaction_id, 'on topic:', topic);
  }, []);

  // Process scored transaction (SAM mode) - update existing pending transaction
  const processScoredTransaction = useCallback((scored: Partial<ScoredTransaction>) => {
    const txId = scored.transaction_id;
    if (!txId) return;
    
    const receivedAt = pendingTxMapRef.current.get(txId);
    const processingTime = receivedAt ? Date.now() - receivedAt : undefined;
    pendingTxMapRef.current.delete(txId);
    
    // Track latency for avg calculation
    if (processingTime) {
      latencyHistoryRef.current.push(processingTime);
      // Keep last 50 samples
      if (latencyHistoryRef.current.length > 50) {
        latencyHistoryRef.current.shift();
      }
      // Update avg latency
      const avg = latencyHistoryRef.current.reduce((a, b) => a + b, 0) / latencyHistoryRef.current.length;
      setAvgLatency(Math.round(avg));
    }
    
    setTransactions((prev) => {
      // Find and update the pending transaction
      const idx = prev.findIndex(t => t.transaction_id === txId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          ...scored,
          risk_score: scored.risk_score ?? 0,
          decision: scored.decision ?? 'approved',
          _status: 'scored',
          processing_time_ms: processingTime,
        };
        return updated;
      }
      // Transaction not found (maybe evicted from list) - add as new
      return [{
        ...scored as ScoredTransaction,
        _status: 'scored',
        processing_time_ms: processingTime,
      }, ...prev].slice(0, 100);
    });
    
    // Track fraud for throughput
    if ((scored.risk_score ?? 0) >= 70) {
      fraudCountRef.current++;
    }
    
    console.log('[useSimulatorSAM] Transaction scored:', txId, 'risk:', scored.risk_score, 'in', processingTime, 'ms');
  }, []);

  // Process alert from SAM
  const processAlert = useCallback((alert: Alert) => {
    setAlerts((prev) => [alert, ...prev].slice(0, 50));
  }, []);

  // Connect to SSE stream for simulator stats
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
        } else if (message.type === 'stats') {
          setSimulatorState(message.data);
        }
        // Transactions come from Solace, not SSE
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Connect to Solace for real-time transaction streaming
  useEffect(() => {

    let mounted = true;
    let client: any = null;

    async function connectSolace() {
      try {
        const { SolaceClient } = await import('@/lib/solace/client');
        
        client = new SolaceClient({
          url: process.env.NEXT_PUBLIC_SOLACE_URL || 'ws://localhost:8008',
          vpnName: process.env.NEXT_PUBLIC_SOLACE_VPN || 'sam',
          userName: process.env.NEXT_PUBLIC_SOLACE_USERNAME || 'sam',
          password: process.env.NEXT_PUBLIC_SOLACE_PASSWORD || 'sam',
        });

        await client.connect();
        
        if (!mounted) {
          client.disconnect();
          return;
        }

        solaceClientRef.current = client;
        setSolaceConnected(true);
        console.log('[useSimulatorSAM] Connected to Solace for dual-subscription mode');

        // SUBSCRIPTION 1: Raw transactions - show immediately with pending status
        // Topic: solace/fraud/v1/transactions/inbound/{country}/{type} (default, can be changed)
        const rawCallback = (message: any) => {
          if (!mounted) return;
          try {
            const topic = SolaceClient.getMessageTopic(message);
            const raw = SolaceClient.parseMessage<Transaction>(message);
            console.log('[useSimulatorSAM] Raw transaction received:', raw.transaction_id, 'on:', topic);
            processRawTransaction(raw, topic);
          } catch (err) {
            console.error('[useSimulatorSAM] Error processing raw transaction:', err);
          }
        };
        rawCallbackRef.current = rawCallback;
        currentRawTopicRef.current = 'solace/fraud/v1/transactions/inbound/>';
        client.subscribe('solace/fraud/v1/transactions/inbound/>', rawCallback);

        // SUBSCRIPTION 2: Scored transactions from SAM OR standalone agents
        // Topics: fraud/transactions/processed/> (SAM gateway) OR fraud/transactions/scored/> (standalone)
        const scoredHandler = (message: any) => {
          if (!mounted) return;
          try {
            const raw = SolaceClient.parseMessage<any>(message);
            console.log('[useSimulatorSAM] Processed transaction received:', raw);
            
            // Handle plain text responses (LLM didn't return JSON)
            if (raw?._isPlainText) {
              console.warn('[useSimulatorSAM] Received plain text response, FULL CONTENT:', raw._text);
              return;
            }
            
            // EMG returns text response from LLM - try to parse as JSON
            let parsed: any;
            if (typeof raw === 'string') {
              // Try to extract JSON from text response
              const jsonMatch = raw.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
              } else {
                console.warn('[useSimulatorSAM] Could not parse LLM response as JSON');
                return;
              }
            } else {
              parsed = raw;
            }
            
            // Skip if no transaction_id (required field)
            if (!parsed.transaction_id && !parsed.risk_score) {
              console.warn('[useSimulatorSAM] No transaction_id or risk_score in response');
              return;
            }
            
            // Build scored transaction update from orchestrator response
            const scoredUpdate: Partial<ScoredTransaction> = {
              transaction_id: parsed.transaction_id,
              timestamp: parsed.timestamp,
              amount: parsed.amount,
              currency: parsed.currency,
              type: parsed.type,
              merchant: parsed.merchant,
              risk_score: parsed.risk_score ?? 0,
              decision: parsed.decision ?? 'approved',
              agent_reasoning: parsed.reasoning || '',
              _fraud_pattern: parsed.detected_patterns?.[0] || parsed.patterns?.[0] || null,
            };
            
            // Update the pending transaction with scored data
            processScoredTransaction(scoredUpdate);
            
            // NOTE: Alerts are generated by the standalone AlertGenerator agent
            // and received via the fraud/alerts/> subscription - no inline alert creation needed
          } catch (err) {
            console.error('[useSimulatorSAM] Error processing scored transaction:', err);
          }
        };
        
        // Subscribe to SAM gateway scored output
        client.subscribe('solace/fraud/v1/transactions/scored', scoredHandler);

        // Subscribe to alerts from SAM
        client.subscribe('solace/fraud/v1/alerts', (message: any) => {
          if (!mounted) return;
          try {
            const parsed = SolaceClient.parseMessage<any>(message);
            console.log('[useSimulatorSAM] Alert received:', parsed);
            
            // Skip plain text responses
            if (parsed?._isPlainText) {
              console.warn('[useSimulatorSAM] Received plain text alert, skipping');
              return;
            }
            
            // Handle nested structure: {alert_generated: true, alert: {...}}
            // vs flat structure: {needs_alert: true, transaction_id: ..., ...}
            const alertData = parsed.alert || parsed;
            const needsAlert = parsed.alert_generated ?? parsed.needs_alert ?? true;
            
            // Skip if no alert needed
            if (needsAlert === false) {
              console.log('[useSimulatorSAM] No alert needed for this transaction');
              return;
            }
            
            // Skip if no transaction_id (malformed response)
            if (!alertData.transaction_id) {
              console.warn('[useSimulatorSAM] Alert missing transaction_id, skipping');
              return;
            }
            
            const alert: Alert = {
              id: alertData.alert_id || alertData.id || alertData.transaction_id || `alert-${Date.now()}`,
              timestamp: alertData.timestamp || new Date().toISOString(),
              severity: alertData.severity || 'medium',
              headline: alertData.headline || alertData.description || 'Fraud Alert',
              transaction_id: alertData.transaction_id || '',
              score: alertData.risk_score || alertData.score || 0,
              pattern: alertData.pattern || alertData.detected_patterns?.[0] || null,
            };
            // Deduplicate alerts by ID
            setAlerts((prev) => {
              if (prev.some(a => a.id === alert.id)) return prev;
              return [alert, ...prev].slice(0, 50);
            });
          } catch (err) {
            console.error('[useSimulatorSAM] Error processing alert:', err);
          }
        });

        // Subscribe to error topic to see agent/orchestrator errors
        client.subscribe('fraud/transactions/errors', (message: any) => {
          if (!mounted) return;
          try {
            const error = SolaceClient.parseMessage<any>(message);
            console.error('[useSimulatorSAM] Transaction processing error:', error);
          } catch (err) {
            console.error('[useSimulatorSAM] Error parsing error message:', err);
          }
        });

        console.log('[useSimulatorSAM] Subscribed to SAM topics (raw + processed + alerts + errors)');
      } catch (error) {
        console.error('[useSimulatorSAM] Solace connection error:', error);
        setSolaceConnected(false);
      }
    }

    connectSolace();

    return () => {
      mounted = false;
      if (client) {
        try {
          client.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      solaceClientRef.current = null;
    };
  }, [processRawTransaction, processScoredTransaction]); // Include callbacks in deps

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
      body: JSON.stringify({ pattern, count: 3 }),
    });
  }, []);

  // Change topic filter - dynamically resubscribe to Solace
  // Solace broker does the filtering server-side!
  const setTopicFilter = useCallback((newTopic: string) => {
    const client = solaceClientRef.current;
    if (!client || !rawCallbackRef.current) {
      console.warn('[useSimulatorSAM] Cannot change topic filter: not connected');
      return;
    }
    
    const oldTopic = currentRawTopicRef.current;
    if (oldTopic === newTopic) return;
    
    console.log('[useSimulatorSAM] Changing topic filter from', oldTopic, 'to', newTopic);
    
    // Clear transactions for fresh start with new filter
    setTransactions([]);
    pendingTxMapRef.current.clear();
    txCountRef.current = 0;
    
    // Resubscribe to new topic (Solace does the filtering!)
    client.resubscribe(oldTopic, newTopic, rawCallbackRef.current);
    
    currentRawTopicRef.current = newTopic;
    setTopicFilterState(newTopic);
  }, []);

  // Compute metrics from state
  const metrics = {
    totalTransactions: simulatorState.totalGenerated,
    fraudDetected: simulatorState.totalFraud,
    fraudBlocked: simulatorState.totalBlocked,
    blockRate: simulatorState.totalFraud > 0 
      ? Math.round((simulatorState.totalBlocked / simulatorState.totalFraud) * 100) 
      : 0,
  };

  return {
    connected: connected && solaceConnected,
    solaceConnected,
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
  };
}
