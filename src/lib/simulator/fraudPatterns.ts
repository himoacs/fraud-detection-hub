import { v4 as uuidv4 } from 'uuid';
import type { Transaction, FraudPattern } from '@/types';

const PATTERN_WEIGHTS: Record<FraudPattern, number> = {
  card_testing: 0.30,
  account_takeover: 0.25,
  velocity_abuse: 0.20,
  geo_anomaly: 0.15,
  amount_spike: 0.10,
};

function randomPattern(): FraudPattern {
  const patterns = Object.keys(PATTERN_WEIGHTS) as FraudPattern[];
  const weights = Object.values(PATTERN_WEIGHTS);
  const total = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  
  for (let i = 0; i < patterns.length; i++) {
    random -= weights[i];
    if (random <= 0) return patterns[i];
  }
  return patterns[0];
}

function baseTransaction(): Partial<Transaction> {
  return {
    transaction_id: `TXN-${uuidv4().slice(0, 16).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    currency: 'USD',
    type: 'card_not_present',
    card: {
      last_four: String(Math.floor(Math.random() * 9000) + 1000),
      brand: 'visa',
    },
    customer: {
      id: `CUST-${Math.floor(Math.random() * 90000) + 10000}`,
      account_age_days: Math.floor(Math.random() * 1000) + 100,
      risk_tier: 'low',
    },
    _fraud_label: true,
  };
}

function cardTesting(): Transaction {
  const base = baseTransaction();
  return {
    ...base,
    amount: Math.round((Math.random() * 4 + 0.5) * 100) / 100,
    merchant: {
      id: `MCH-${Math.floor(Math.random() * 9000) + 1000}`,
      name: 'Digital Games Store',
      category: 'digital_goods',
      country: 'US',
      city: 'New York',
    },
    device: {
      id: `DEV-NEW-${uuidv4().slice(0, 8)}`,
      type: 'web_browser',
      ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.0.1`,
    },
    velocity: {
      txns_last_hour: Math.floor(Math.random() * 12) + 8,
      txns_last_day: Math.floor(Math.random() * 12) + 8,
      amount_last_day: Math.round(Math.random() * 30 + 10),
    },
    _fraud_pattern: 'card_testing',
    _fraud_signals: ['high_velocity', 'micro_amounts', 'digital_merchant'],
  } as Transaction;
}

function accountTakeover(): Transaction {
  const base = baseTransaction();
  const riskyCountries = ['NG', 'RO', 'UA', 'PH'];
  return {
    ...base,
    amount: Math.round((Math.random() * 4000 + 800) * 100) / 100,
    merchant: {
      id: `MCH-${Math.floor(Math.random() * 9000) + 1000}`,
      name: 'Electronics Outlet',
      category: 'electronics',
      country: riskyCountries[Math.floor(Math.random() * riskyCountries.length)],
      city: 'Unknown',
    },
    device: {
      id: `DEV-NEW-${uuidv4().slice(0, 8)}`,
      type: 'mobile_browser',
      ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.0.1`,
      is_new: true,
    },
    velocity: {
      txns_last_hour: 1,
      txns_last_day: 1,
      amount_last_day: 0,
    },
    _fraud_pattern: 'account_takeover',
    _fraud_signals: ['new_device', 'high_risk_country', 'high_amount'],
  } as Transaction;
}

function velocityAbuse(): Transaction {
  const base = baseTransaction();
  return {
    ...base,
    amount: Math.round((Math.random() * 700 + 200) * 100) / 100,
    merchant: {
      id: `MCH-${Math.floor(Math.random() * 9000) + 1000}`,
      name: 'Online Marketplace',
      category: 'retail',
      country: 'US',
      city: 'Chicago',
    },
    device: {
      id: `DEV-${Math.floor(Math.random() * 99999)}`,
      type: 'web_browser',
      ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
    },
    velocity: {
      txns_last_hour: Math.floor(Math.random() * 25) + 15,
      txns_last_day: Math.floor(Math.random() * 25) + 15,
      amount_last_day: Math.round((Math.random() * 10000 + 3000) * 100) / 100,
    },
    _fraud_pattern: 'velocity_abuse',
    _fraud_signals: ['extreme_velocity', 'high_daily_amount'],
  } as Transaction;
}

function geoAnomaly(): Transaction {
  const base = baseTransaction();
  const destinations = [
    { country: 'NG', city: 'Lagos' },
    { country: 'PH', city: 'Manila' },
    { country: 'BR', city: 'São Paulo' },
    { country: 'IN', city: 'Mumbai' },
  ];
  const destination = destinations[Math.floor(Math.random() * destinations.length)];

  return {
    ...base,
    amount: Math.round((Math.random() * 800 + 100) * 100) / 100,
    merchant: {
      id: `MCH-${Math.floor(Math.random() * 9000) + 1000}`,
      name: 'International Shop',
      category: 'retail',
      country: destination.country,
      city: destination.city,
    },
    device: {
      id: `DEV-${Math.floor(Math.random() * 99999)}`,
      type: 'mobile_browser',
      ip: `41.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.1`,
    },
    velocity: {
      txns_last_hour: 2,
      txns_last_day: 5,
      amount_last_day: 250,
    },
    _previous_location: {
      country: 'US',
      city: 'New York',
      minutes_ago: Math.floor(Math.random() * 30) + 15,
    },
    _fraud_pattern: 'geo_anomaly',
    _fraud_signals: ['impossible_travel', 'high_risk_country'],
  } as Transaction;
}

function amountSpike(): Transaction {
  const base = baseTransaction();
  return {
    ...base,
    amount: Math.round((Math.random() * 6000 + 3000) * 100) / 100,
    merchant: {
      id: `MCH-${Math.floor(Math.random() * 9000) + 1000}`,
      name: 'Luxury Boutique',
      category: 'luxury',
      country: 'US',
      city: 'Beverly Hills',
    },
    device: {
      id: `DEV-${Math.floor(Math.random() * 99999)}`,
      type: 'web_browser',
      ip: `172.16.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
    },
    velocity: {
      txns_last_hour: 0,
      txns_last_day: 2,
      amount_last_day: Math.round((Math.random() * 100 + 50) * 100) / 100,
    },
    _fraud_pattern: 'amount_spike',
    _fraud_signals: ['amount_10x_average', 'luxury_merchant'],
  } as Transaction;
}

export function generateFraudTransaction(pattern?: FraudPattern): Transaction {
  const selectedPattern = pattern || randomPattern();
  
  switch (selectedPattern) {
    case 'card_testing': return cardTesting();
    case 'account_takeover': return accountTakeover();
    case 'velocity_abuse': return velocityAbuse();
    case 'geo_anomaly': return geoAnomaly();
    case 'amount_spike': return amountSpike();
    default: return cardTesting();
  }
}

export { randomPattern };
export type { FraudPattern };
