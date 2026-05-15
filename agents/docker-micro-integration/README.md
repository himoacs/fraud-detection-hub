# Fraud Detection Database Persistence (Micro-Integration)

A lightweight Docker-based service that persists Solace event streams to PostgreSQL for analytics and SAM agent queries.

## Overview

This micro-integration subscribes to three Solace queues and writes events to dedicated PostgreSQL tables, enabling SQL-based analytics via SAM's SQL connector.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Solace Event Broker                                   │
│                                                                              │
│  Queues:                                                                     │
│  ├── fraud/q/db-raw-transactions      ← Raw incoming transactions           │
│  ├── fraud/q/db-scored-transactions   ← AI-scored transactions              │
│  └── fraud/q/db-alerts                ← Generated fraud alerts              │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Persistence Service (Docker)                              │
│                                                                              │
│  fraud-db-persistence container                                              │
│  ├── Python 3.11 + solace-pubsubplus SDK                                    │
│  ├── Persistent message receivers (guaranteed delivery)                      │
│  └── Extracts key fields + stores full JSONB payload                        │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL Database                                  │
│                                                                              │
│  Tables:                                                                     │
│  ├── raw_transactions      ← transaction_id, amount, merchant, country      │
│  ├── scored_transactions   ← risk_score, risk_level, decision, patterns     │
│  └── alerts                ← alert_generated, severity, alert_type          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

### raw_transactions

Stores incoming transaction data with extracted fields for easy querying.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `transaction_id` | VARCHAR(50) | Unique transaction identifier |
| `amount` | DECIMAL(12,2) | Transaction amount |
| `currency` | VARCHAR(10) | Currency code (USD, EUR, etc.) |
| `merchant_name` | VARCHAR(255) | Merchant name |
| `customer_id` | VARCHAR(50) | Customer identifier |
| `country` | VARCHAR(10) | Merchant country code |
| `topic` | VARCHAR(255) | Solace topic the message arrived on |
| `payload` | JSONB | Full transaction payload |
| `received_at` | TIMESTAMPTZ | When the record was inserted |

### scored_transactions

Stores AI-scored transaction results.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `transaction_id` | VARCHAR(50) | Links to raw_transactions |
| `risk_score` | INTEGER | AI-assigned risk score (0-100) |
| `risk_level` | VARCHAR(20) | low / medium / high |
| `decision` | VARCHAR(20) | approved / review / blocked |
| `detected_patterns` | TEXT[] | Array of fraud patterns detected |
| `topic` | VARCHAR(255) | Solace topic |
| `payload` | JSONB | Full scored payload with reasoning |
| `received_at` | TIMESTAMPTZ | When the record was inserted |

### alerts

Stores generated fraud alerts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `transaction_id` | VARCHAR(50) | Links to scored_transactions |
| `alert_generated` | BOOLEAN | Whether an alert was created |
| `alert_type` | VARCHAR(50) | Fraud patterns (comma-separated) |
| `severity` | VARCHAR(20) | low / medium / high |
| `reason` | TEXT | Alert description or skip reason |
| `topic` | VARCHAR(255) | Solace topic |
| `payload` | JSONB | Full alert payload |
| `received_at` | TIMESTAMPTZ | When the record was inserted |

## Quick Start

### 1. Create Database Tables

```bash
kubectl exec agent-mesh-postgresql-0 -- psql -U postgres -d fraud_detection -c "
DROP TABLE IF EXISTS raw_transactions CASCADE;
CREATE TABLE raw_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50),
    amount DECIMAL(12,2),
    currency VARCHAR(10),
    merchant_name VARCHAR(255),
    customer_id VARCHAR(50),
    country VARCHAR(10),
    topic VARCHAR(255),
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS scored_transactions CASCADE;
CREATE TABLE scored_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50),
    risk_score INTEGER,
    risk_level VARCHAR(20),
    decision VARCHAR(20),
    detected_patterns TEXT[],
    topic VARCHAR(255),
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS alerts CASCADE;
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50),
    alert_generated BOOLEAN,
    alert_type VARCHAR(50),
    severity VARCHAR(20),
    reason TEXT,
    topic VARCHAR(255),
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW()
);"
```

### 2. Build the Docker Image

```bash
cd agents/docker-micro-integration
docker build -f Dockerfile.persistence -t fraud-persistence:latest .
```

### 3. Run the Service

```bash
docker run -d --name fraud-db-persistence \
  --network demo-net \
  -e SOLACE_BROKER_URL=ws://solace:8008 \
  -e SOLACE_BROKER_VPN=sam \
  -e SOLACE_BROKER_USERNAME=sam \
  -e SOLACE_BROKER_PASSWORD=sam \
  -e POSTGRES_HOST=host.docker.internal \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DATABASE=fraud_detection \
  fraud-persistence:latest
```

### 4. Verify Data Flow

```bash
# Check logs
docker logs fraud-db-persistence --tail 30

# Check table counts
kubectl exec agent-mesh-postgresql-0 -- psql -U postgres -d fraud_detection -c "
SELECT 'raw_transactions' as tbl, COUNT(*) FROM raw_transactions
UNION ALL SELECT 'scored_transactions', COUNT(*) FROM scored_transactions
UNION ALL SELECT 'alerts', COUNT(*) FROM alerts;"
```

## Example Queries

### High-Risk Transactions
```sql
SELECT transaction_id, risk_score, risk_level, decision, detected_patterns
FROM scored_transactions
WHERE risk_score >= 70
ORDER BY received_at DESC
LIMIT 10;
```

### Blocked Transactions by Country
```sql
SELECT r.country, COUNT(*) as blocked_count, AVG(s.risk_score) as avg_score
FROM raw_transactions r
JOIN scored_transactions s ON r.transaction_id = s.transaction_id
WHERE s.decision = 'blocked'
GROUP BY r.country
ORDER BY blocked_count DESC;
```

### Recent Alerts by Severity
```sql
SELECT transaction_id, alert_type, severity, reason, received_at
FROM alerts
WHERE alert_generated = true
ORDER BY 
    CASE severity 
        WHEN 'high' THEN 1 
        WHEN 'medium' THEN 2 
        ELSE 3 
    END,
    received_at DESC
LIMIT 20;
```

### Transaction Amount Analysis
```sql
SELECT 
    DATE(received_at) as date,
    COUNT(*) as txn_count,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount,
    MAX(amount) as max_amount
FROM raw_transactions
GROUP BY DATE(received_at)
ORDER BY date DESC;
```

### Fraud Pattern Distribution
```sql
SELECT unnest(detected_patterns) as pattern, COUNT(*) as count
FROM scored_transactions
WHERE detected_patterns IS NOT NULL
GROUP BY pattern
ORDER BY count DESC;
```

### Join All Three Tables
```sql
SELECT 
    r.transaction_id,
    r.amount,
    r.merchant_name,
    r.country,
    s.risk_score,
    s.decision,
    a.alert_generated,
    a.severity
FROM raw_transactions r
LEFT JOIN scored_transactions s ON r.transaction_id = s.transaction_id
LEFT JOIN alerts a ON s.transaction_id = a.transaction_id
WHERE r.amount > 100
ORDER BY r.received_at DESC
LIMIT 20;
```

## SAM Agent SQL Integration

SAM agents can query these tables using the SQL connector. Example prompts:

- *"Show me all blocked transactions from Germany"*
- *"What's the average risk score by merchant category?"*
- *"List high-severity alerts from the last hour"*
- *"Which countries have the most flagged transactions?"*

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLACE_BROKER_URL` | `ws://solace:8008` | Solace broker WebSocket URL |
| `SOLACE_BROKER_VPN` | `sam` | Message VPN name |
| `SOLACE_BROKER_USERNAME` | `sam` | Broker username |
| `SOLACE_BROKER_PASSWORD` | `sam` | Broker password |
| `POSTGRES_HOST` | `host.docker.internal` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | `password` | Database password |
| `POSTGRES_DATABASE` | `fraud_detection` | Database name |

## Files

| File | Description |
|------|-------------|
| `persistence_service.py` | Main Python service with Solace SDK |
| `Dockerfile.persistence` | Docker build file |
| `config.yaml` | Legacy SAM connector config (not used) |

## Troubleshooting

### Check service logs
```bash
docker logs fraud-db-persistence --tail 50
```

### Verify Solace connectivity
```bash
docker logs fraud-db-persistence 2>&1 | grep "Connected to Solace"
```

### Test PostgreSQL access
```bash
docker exec fraud-db-persistence python3 -c "
import psycopg2
conn = psycopg2.connect(
    host='host.docker.internal',
    port=5432,
    user='postgres',
    password='password',
    database='fraud_detection'
)
print('PostgreSQL connected!')
conn.close()
"
```

### Rebuild after code changes
```bash
cd agents/docker-micro-integration
docker build -f Dockerfile.persistence -t fraud-persistence:latest .
docker stop fraud-db-persistence && docker rm fraud-db-persistence
# Re-run docker run command above
```
