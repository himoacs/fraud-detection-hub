// Transaction Types
export interface Merchant {
  id: string;
  name: string;
  category: string;
  country: string;
  city: string;
}

export interface Card {
  last_four: string;
  brand: string;
}

export interface Customer {
  id: string;
  account_age_days: number;
  risk_tier: 'low' | 'medium' | 'high';
}

export interface Device {
  id: string;
  type: string;
  ip: string;
  is_new?: boolean;
}

export interface Velocity {
  txns_last_hour: number;
  txns_last_day: number;
  amount_last_day: number;
}

export interface PreviousLocation {
  country: string;
  city: string;
  minutes_ago: number;
}

export interface Transaction {
  transaction_id: string;
  timestamp: string;
  amount: number;
  currency: string;
  type: 'card_present' | 'card_not_present' | 'ach' | 'wire';
  merchant: Merchant;
  card: Card;
  customer: Customer;
  device: Device;
  velocity: Velocity;
  _fraud_label: boolean;
  _fraud_pattern?: FraudPattern;
  _fraud_signals?: string[];
  _previous_location?: PreviousLocation;
  _topic?: string; // Actual Solace topic this transaction arrived on
}

export type FraudPattern = 
  | 'card_testing' 
  | 'account_takeover' 
  | 'velocity_abuse' 
  | 'geo_anomaly' 
  | 'amount_spike';

// Transaction processing status for dual-subscription flow
export type TransactionStatus = 'pending' | 'processing' | 'scored' | 'error';

// Scored transaction (after SAM processing)
export interface ScoredTransaction extends Transaction {
  risk_score: number;
  confidence: number;
  decision: 'approved' | 'blocked' | 'review';
  agent_reasoning?: string;
  factors?: Record<string, number>;
  processing_time_ms?: number;
  // Status for tracking SAM processing state
  _status?: TransactionStatus;
  _received_at?: number; // timestamp when raw transaction received
}

// Alert Types
export interface Alert {
  alert_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  transaction_id: string;
  pattern: string;
  headline: string;
  description: string;
  timestamp: string;
  score: number;
}

// Metrics Types
export interface AgentStats {
  count: number;
  avg_ms: number;
}

export interface Metrics {
  timestamp: string;
  throughput: number;
  fraud_rate: number;
  blocked_count: number;
  review_count: number;
  approved_count: number;
  avg_latency_ms: number;
  agent_stats?: Record<string, AgentStats>;
}

// Simulator State
export interface SimulatorState {
  running: boolean;
  paused: boolean;
  ratePerSecond: number;
  fraudRate: number;
  totalGenerated: number;
  totalFraud: number;
  totalBlocked: number;
  startTime: number | null;
}

// API Response Types
export interface SimulatorResponse {
  status: string;
  running?: boolean;
  rate?: number;
  fraudRate?: number;
  stats?: SimulatorState;
}
