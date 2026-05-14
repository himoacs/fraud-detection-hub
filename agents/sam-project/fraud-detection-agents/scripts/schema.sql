-- Fraud Detection Hub - PostgreSQL Schema
-- Tables for storing transactions and alerts for SAM SQL Connector queries

-- Raw transactions table - stores incoming transactions before scoring
CREATE TABLE IF NOT EXISTS raw_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Original transaction data
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    timestamp TIMESTAMPTZ NOT NULL,
    
    -- Merchant info
    merchant_name VARCHAR(255),
    merchant_category VARCHAR(100),
    merchant_country VARCHAR(2),
    merchant_city VARCHAR(100),
    
    -- Card/Account info
    card_type VARCHAR(50),
    card_last_four VARCHAR(4),
    
    -- Device info
    device_fingerprint VARCHAR(64),
    device_type VARCHAR(50),
    ip_address VARCHAR(45),
    
    -- Raw payload (full original message)
    raw_payload JSONB NOT NULL,
    
    -- Processing status
    scored BOOLEAN DEFAULT FALSE,
    scored_at TIMESTAMPTZ
);

-- Scored transactions table - stores all scored transactions
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Transaction details
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Risk scoring
    risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    confidence DECIMAL(3, 2) CHECK (confidence >= 0 AND confidence <= 1),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'blocked', 'review')),
    
    -- Fraud patterns (stored as JSON array)
    detected_patterns JSONB DEFAULT '[]',
    agent_reasoning TEXT,
    
    -- Merchant info
    merchant_name VARCHAR(255),
    merchant_category VARCHAR(100),
    merchant_country VARCHAR(2),
    merchant_city VARCHAR(100),
    
    -- Device info
    device_fingerprint VARCHAR(64),
    device_type VARCHAR(50),
    vpn_detected BOOLEAN DEFAULT FALSE,
    new_device BOOLEAN DEFAULT FALSE,
    
    -- Velocity metrics at time of transaction
    velocity_txns_last_hour INTEGER DEFAULT 0,
    velocity_txns_last_day INTEGER DEFAULT 0,
    
    -- Fraud label (for demo/training purposes)
    is_fraud BOOLEAN DEFAULT FALSE,
    fraud_pattern VARCHAR(100),
    
    -- Indexes for common queries
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts table - stores generated fraud alerts
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    alert_id VARCHAR(64) UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Alert details
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    headline VARCHAR(255) NOT NULL,
    
    -- Related transaction
    transaction_id VARCHAR(64) REFERENCES transactions(transaction_id),
    
    -- Alert metadata
    risk_score INTEGER NOT NULL,
    primary_pattern VARCHAR(100),
    all_patterns JSONB DEFAULT '[]',
    
    -- Transaction context (denormalized for quick access)
    amount DECIMAL(12, 2),
    currency VARCHAR(3) DEFAULT 'USD',
    merchant_name VARCHAR(255),
    merchant_country VARCHAR(2),
    
    -- Alert status
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(100),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_risk_score ON transactions(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_decision ON transactions(decision);
CREATE INDEX IF NOT EXISTS idx_transactions_country ON transactions(merchant_country);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(merchant_category);
CREATE INDEX IF NOT EXISTS idx_transactions_is_fraud ON transactions(is_fraud);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_transaction_id ON alerts(transaction_id);

CREATE INDEX IF NOT EXISTS idx_raw_transactions_received_at ON raw_transactions(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_transactions_scored ON raw_transactions(scored);
CREATE INDEX IF NOT EXISTS idx_raw_transactions_country ON raw_transactions(merchant_country);
CREATE INDEX IF NOT EXISTS idx_raw_transactions_category ON raw_transactions(merchant_category);

-- Useful views for common analytics queries

-- Current fraud rate (last hour)
CREATE OR REPLACE VIEW fraud_rate_hourly AS
SELECT 
    COUNT(*) AS total_transactions,
    COUNT(*) FILTER (WHERE risk_score >= 70) AS high_risk_count,
    COUNT(*) FILTER (WHERE decision = 'blocked') AS blocked_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE risk_score >= 70) / NULLIF(COUNT(*), 0), 2) AS fraud_rate_percent,
    ROUND(AVG(risk_score), 2) AS avg_risk_score
FROM transactions
WHERE timestamp > NOW() - INTERVAL '1 hour';

-- Fraud by country
CREATE OR REPLACE VIEW fraud_by_country AS
SELECT 
    merchant_country,
    COUNT(*) AS total_transactions,
    COUNT(*) FILTER (WHERE risk_score >= 70) AS high_risk_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE risk_score >= 70) / NULLIF(COUNT(*), 0), 2) AS fraud_rate_percent,
    ROUND(AVG(risk_score), 2) AS avg_risk_score
FROM transactions
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY merchant_country
ORDER BY high_risk_count DESC;

-- Fraud by pattern
CREATE OR REPLACE VIEW fraud_by_pattern AS
SELECT 
    pattern,
    COUNT(*) AS occurrence_count,
    ROUND(AVG(t.risk_score), 2) AS avg_risk_score
FROM transactions t,
     LATERAL jsonb_array_elements_text(t.detected_patterns) AS pattern
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY pattern
ORDER BY occurrence_count DESC;

-- Recent high-risk transactions
CREATE OR REPLACE VIEW recent_high_risk AS
SELECT 
    transaction_id,
    timestamp,
    amount,
    risk_score,
    decision,
    detected_patterns,
    merchant_name,
    merchant_country,
    agent_reasoning
FROM transactions
WHERE risk_score >= 70
ORDER BY timestamp DESC
LIMIT 100;

-- Hourly summary
CREATE OR REPLACE VIEW hourly_summary AS
SELECT 
    date_trunc('hour', timestamp) AS hour,
    COUNT(*) AS total_transactions,
    COUNT(*) FILTER (WHERE decision = 'approved') AS approved,
    COUNT(*) FILTER (WHERE decision = 'blocked') AS blocked,
    COUNT(*) FILTER (WHERE decision = 'review') AS review,
    ROUND(SUM(amount), 2) AS total_amount,
    ROUND(AVG(risk_score), 2) AS avg_risk_score
FROM transactions
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY date_trunc('hour', timestamp)
ORDER BY hour DESC;
