import { v4 as uuidv4 } from 'uuid';
import { generateFraudTransaction } from './fraudPatterns';
import type { Transaction, FraudPattern, SimulatorState, ScoredTransaction } from '@/types';

// Operating mode: 'demo' = local scoring, 'sam' = publish to Solace for SAM processing
type SimulatorMode = 'demo' | 'sam';
let simulatorMode: SimulatorMode = 'demo';

// Simulator state (module-level singleton)
const state: SimulatorState = {
  running: false,
  paused: false,
  ratePerSecond: 5,
  fraudRate: 0.05,
  totalGenerated: 0,
  totalFraud: 0,
  totalBlocked: 0,
  startTime: null,
};

let intervalId: NodeJS.Timeout | null = null;
let publishCallback: ((tx: ScoredTransaction) => void) | null = null;
let rawPublishCallback: ((tx: Transaction) => void) | null = null;

// Accumulator for fractional rate handling (for rates < 10 tx/sec)
let txAccumulator = 0;

// Data for realistic transactions
const MERCHANT_NAMES = [
  'Amazon', 'Walmart', 'Target', 'Starbucks', 'McDonalds',
  'Apple Store', 'Best Buy', 'Shell Gas', 'Uber', 'Netflix',
  'Spotify', 'Whole Foods', 'CVS Pharmacy', 'Home Depot', 'Costco'
];

const MERCHANT_CATEGORIES = ['retail', 'food', 'travel', 'entertainment', 'utilities', 'gas', 'grocery'];

const CITIES: Record<string, string[]> = {
  US: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'San Francisco', 'Seattle', 'Boston', 'Miami', 'Denver'],
  GB: ['London', 'Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Edinburgh'],
  DE: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'],
  JP: ['Tokyo', 'Osaka', 'Kyoto', 'Yokohama', 'Nagoya'],
  CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
};

function randomChoice<T>(arr: T[], weights?: number[]): T {
  if (weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * total;
    for (let i = 0; i < arr.length; i++) {
      random -= weights[i];
      if (random <= 0) return arr[i];
    }
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateLegitTransaction(): Transaction {
  const txType = randomChoice(
    ['card_present', 'card_not_present', 'ach', 'wire'] as const,
    [0.45, 0.35, 0.15, 0.05]
  );

  const country = randomChoice(['US', 'GB', 'DE', 'JP', 'CA', 'AU'], [0.55, 0.15, 0.10, 0.08, 0.07, 0.05]);
  const customerId = `CUST-${Math.floor(Math.random() * 90000) + 10000}`;

  // Log-normal distribution for realistic amounts
  const amount = Math.min(Math.round(Math.exp(3.5 + Math.random() * 1.5) * 100) / 100, 9999.99);

  return {
    transaction_id: `TXN-${uuidv4().slice(0, 16).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    amount,
    currency: 'USD',
    type: txType,
    merchant: {
      id: `MCH-${Math.floor(Math.random() * 9000) + 1000}`,
      name: randomChoice(MERCHANT_NAMES),
      category: randomChoice(MERCHANT_CATEGORIES),
      country,
      city: randomChoice(CITIES[country] || ['Unknown']),
    },
    card: {
      last_four: String(Math.floor(Math.random() * 9000) + 1000),
      brand: randomChoice(['visa', 'mastercard', 'amex'], [0.5, 0.35, 0.15]),
    },
    customer: {
      id: customerId,
      account_age_days: Math.floor(Math.random() * 2000) + 30,
      risk_tier: randomChoice(['low', 'medium', 'high'] as const, [0.7, 0.25, 0.05]),
    },
    device: {
      id: `DEV-${Math.abs(customerId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 100000}`,
      type: txType === 'card_present' ? 'pos_terminal' : 'web_browser',
      ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
    },
    velocity: {
      txns_last_hour: Math.floor(Math.random() * 4),
      txns_last_day: Math.floor(Math.random() * 10) + 1,
      amount_last_day: Math.round((Math.random() * 500 + 50) * 100) / 100,
    },
    _fraud_label: false,
  };
}

function scoreTransaction(tx: Transaction): ScoredTransaction {
  // Simulate SAM agent scoring
  let riskScore = 0;
  const factors: Record<string, number> = {};
  const signals: string[] = [];

  if (tx._fraud_label) {
    // Fraud transaction - high score
    riskScore = Math.floor(Math.random() * 20) + 75; // 75-95

    if (tx._fraud_pattern === 'card_testing') {
      factors.velocity = 0.40;
      factors.amount = 0.30;
      factors.pattern = 0.30;
      signals.push('Card testing pattern detected');
    } else if (tx._fraud_pattern === 'account_takeover') {
      factors.device = 0.35;
      factors.geo = 0.35;
      factors.amount = 0.30;
      signals.push('New device from high-risk location');
    } else if (tx._fraud_pattern === 'velocity_abuse') {
      factors.velocity = 0.50;
      factors.amount = 0.30;
      factors.pattern = 0.20;
      signals.push('Extreme transaction velocity');
    } else if (tx._fraud_pattern === 'geo_anomaly') {
      factors.geo = 0.50;
      factors.velocity = 0.25;
      factors.device = 0.25;
      signals.push('Impossible travel detected');
    } else if (tx._fraud_pattern === 'amount_spike') {
      factors.amount = 0.50;
      factors.pattern = 0.30;
      factors.merchant = 0.20;
      signals.push('Amount significantly above average');
    }
  } else {
    // Legitimate transaction - low score
    riskScore = Math.floor(Math.random() * 25); // 0-25
    factors.baseline = 1.0;
  }

  const decision: 'approved' | 'blocked' | 'review' = 
    riskScore >= 80 ? 'blocked' : 
    riskScore >= 50 ? 'review' : 'approved';

  const reasoning = tx._fraud_label
    ? `High risk detected: ${tx._fraud_signals?.join(', ') || 'Multiple fraud indicators'}. Score: ${riskScore}/100.`
    : `Normal transaction pattern. Low risk score: ${riskScore}/100.`;

  return {
    ...tx,
    risk_score: riskScore,
    confidence: 0.85 + Math.random() * 0.14,
    decision,
    agent_reasoning: reasoning,
    factors,
    processing_time_ms: Math.floor(Math.random() * 100) + 50,
  };
}

function generateTransaction(): ScoredTransaction {
  const isFraud = Math.random() < state.fraudRate;

  let tx: Transaction;
  if (isFraud) {
    tx = generateFraudTransaction();
    state.totalFraud++;
  } else {
    tx = generateLegitTransaction();
  }

  const scored = scoreTransaction(tx);
  if (scored.decision === 'blocked') {
    state.totalBlocked++;
  }

  return scored;
}

function runBatch(): void {
  if (!state.running || state.paused) return;

  // Accumulate fractional transactions
  // Interval runs 10 times/sec, so add rate/10 each time
  txAccumulator += state.ratePerSecond / 10;
  
  // Generate only whole transactions
  const batchSize = Math.floor(txAccumulator);
  txAccumulator -= batchSize; // Keep remainder for next interval

  for (let i = 0; i < batchSize; i++) {
    if (simulatorMode === 'sam' && rawPublishCallback) {
      // SAM mode: publish raw transaction to Solace for agent processing
      const isFraud = Math.random() < state.fraudRate;
      let tx: Transaction;
      if (isFraud) {
        tx = generateFraudTransaction();
        state.totalFraud++;
      } else {
        tx = generateLegitTransaction();
      }
      state.totalGenerated++;
      rawPublishCallback(tx);
    } else if (publishCallback) {
      // Demo mode: score locally and publish scored transaction
      const tx = generateTransaction();
      state.totalGenerated++;
      publishCallback(tx);
    }
  }
}

export function setPublishCallback(callback: (tx: ScoredTransaction) => void): void {
  publishCallback = callback;
}

export function setRawPublishCallback(callback: (tx: Transaction) => void): void {
  rawPublishCallback = callback;
}

export function setMode(mode: SimulatorMode): void {
  simulatorMode = mode;
  console.log(`[Generator] Mode set to: ${mode}`);
}

export function getMode(): SimulatorMode {
  return simulatorMode;
}

export function start(): SimulatorState {
  if (state.running) return { ...state };

  state.running = true;
  state.paused = false;
  state.startTime = Date.now();
  txAccumulator = 0; // Reset accumulator on start

  // Run batches every 100ms (10 batches per second)
  intervalId = setInterval(runBatch, 100);

  return { ...state };
}

export function stop(): SimulatorState {
  state.running = false;
  state.paused = false;
  txAccumulator = 0; // Reset accumulator on stop

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  return { ...state };
}

export function pause(): SimulatorState {
  state.paused = true;
  return { ...state };
}

export function resume(): SimulatorState {
  state.paused = false;
  return { ...state };
}

export function setRate(rate: number): SimulatorState {
  state.ratePerSecond = Math.max(1, Math.min(5000, rate));
  return { ...state };
}

export function setFraudRate(rate: number): SimulatorState {
  state.fraudRate = Math.max(0, Math.min(1, rate));
  return { ...state };
}

export function injectFraud(pattern: FraudPattern, count: number = 1): void {
  for (let i = 0; i < count; i++) {
    const tx = generateFraudTransaction(pattern);
    state.totalGenerated++;
    state.totalFraud++;

    if (simulatorMode === 'sam' && rawPublishCallback) {
      // SAM mode: publish raw fraud transaction to Solace
      rawPublishCallback(tx);
    } else if (publishCallback) {
      // Demo mode: score locally and broadcast
      const scored = scoreTransaction(tx);
      if (scored.decision === 'blocked') {
        state.totalBlocked++;
      }
      publishCallback(scored);
    }
  }
}

export function getStats(): SimulatorState & { actualRate: number; elapsedSeconds: number } {
  const elapsedSeconds = state.startTime
    ? (Date.now() - state.startTime) / 1000
    : 0;

  return {
    ...state,
    actualRate: elapsedSeconds > 0 ? Math.round(state.totalGenerated / elapsedSeconds) : 0,
    elapsedSeconds: Math.round(elapsedSeconds),
  };
}

export function reset(): void {
  state.totalGenerated = 0;
  state.totalFraud = 0;
  state.totalBlocked = 0;
  state.startTime = null;
}
