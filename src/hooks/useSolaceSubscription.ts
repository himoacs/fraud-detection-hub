'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { ScoredTransaction, Alert, Metrics } from '@/types';

// Solace subscription state
interface SolaceState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  transactions: ScoredTransaction[];
  alerts: Alert[];
  metrics: Metrics | null;
}

// Event handlers for different message types
interface SolaceEventHandlers {
  onTransaction?: (tx: ScoredTransaction) => void;
  onAlert?: (alert: Alert) => void;
  onMetrics?: (metrics: Metrics) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}

const MAX_TRANSACTIONS = 100;
const MAX_ALERTS = 50;

export function useSolaceSubscription(
  enabled: boolean = true,
  handlers?: SolaceEventHandlers
) {
  const [state, setState] = useState<SolaceState>({
    connected: false,
    connecting: false,
    error: null,
    transactions: [],
    alerts: [],
    metrics: null,
  });
  
  const clientRef = useRef<any>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Connect to Solace and subscribe to topics
  const connect = useCallback(async () => {
    if (clientRef.current || state.connecting) return;

    setState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      // Dynamic import to avoid SSR issues
      const { SolaceClient } = await import('@/lib/solace/client');
      
      const client = new SolaceClient({
        url: process.env.NEXT_PUBLIC_SOLACE_URL || 'ws://localhost:8008',
        vpnName: process.env.NEXT_PUBLIC_SOLACE_VPN || 'sam',
        userName: process.env.NEXT_PUBLIC_SOLACE_USERNAME || 'sam',
        password: process.env.NEXT_PUBLIC_SOLACE_PASSWORD || 'sam',
      });

      await client.connect();
      clientRef.current = client;

      // Subscribe to scored transactions from SAM agents
      client.subscribe('fraud/transactions/scored/>', (message: any) => {
        const tx = SolaceClient.parseMessage<ScoredTransaction>(message);
        
        setState(prev => ({
          ...prev,
          transactions: [tx, ...prev.transactions].slice(0, MAX_TRANSACTIONS),
        }));
        
        handlersRef.current?.onTransaction?.(tx);
      });

      // Subscribe to alerts
      client.subscribe('fraud/alerts/>', (message: any) => {
        const alert = SolaceClient.parseMessage<Alert>(message);
        
        setState(prev => ({
          ...prev,
          alerts: [alert, ...prev.alerts].slice(0, MAX_ALERTS),
        }));
        
        handlersRef.current?.onAlert?.(alert);
      });

      // Subscribe to metrics aggregates
      client.subscribe('fraud/metrics/aggregates', (message: any) => {
        const metrics = SolaceClient.parseMessage<Metrics>(message);
        
        setState(prev => ({ ...prev, metrics }));
        
        handlersRef.current?.onMetrics?.(metrics);
      });

      setState(prev => ({ 
        ...prev, 
        connected: true, 
        connecting: false 
      }));
      
      handlersRef.current?.onConnect?.();
      console.log('[useSolaceSubscription] Connected and subscribed');
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ 
        ...prev, 
        connected: false, 
        connecting: false, 
        error: errorMsg 
      }));
      
      handlersRef.current?.onError?.(errorMsg);
      console.error('[useSolaceSubscription] Connection error:', error);
    }
  }, [state.connecting]);

  // Disconnect from Solace
  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
      
      setState(prev => ({ 
        ...prev, 
        connected: false,
        connecting: false,
      }));
      
      handlersRef.current?.onDisconnect?.();
      console.log('[useSolaceSubscription] Disconnected');
    }
  }, []);

  // Clear accumulated data
  const clearData = useCallback(() => {
    setState(prev => ({
      ...prev,
      transactions: [],
      alerts: [],
      metrics: null,
    }));
  }, []);

  // Auto-connect when enabled
  useEffect(() => {
    if (enabled && !state.connected && !state.connecting) {
      connect();
    } else if (!enabled && state.connected) {
      disconnect();
    }
    
    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [enabled, state.connected, state.connecting, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    clearData,
    transactionCount: state.transactions.length,
    alertCount: state.alerts.length,
    criticalAlertCount: state.alerts.filter(a => a.severity === 'critical').length,
  };
}
