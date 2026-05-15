# Fraud Database Persistence Connector

SAM connector that persists all fraud transactions and alerts to PostgreSQL for chat-based SQL queries.

## Architecture

```
Simulator
    │
    ▼ publish
┌─────────────────────────────────────────────────────────────┐
│                    Solace Broker                             │
│                                                              │
│  Topics:                                                     │
│  ├── solace/fraud/v1/transactions/inbound/>  ──────────┐    │
│  ├── solace/fraud/v1/transactions/scored     ──────────┼─┐  │
│  └── solace/fraud/v1/alerts                  ──────────┼─┼─┐│
│                                                        │ │ ││
│  Queues (exclusive for persistence):                   │ │ ││
│  ├── fraud/q/db-raw-transactions  ◄───────────────────-┘ │ ││
│  ├── fraud/q/db-scored-transactions  ◄───────────────────┘ ││
│  └── fraud/q/db-alerts  ◄───────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│            Database Persistence Connector                    │
│                                                              │
│  Flow 1: persist_raw_transactions                           │
│  Flow 2: persist_scored_transactions                        │
│  Flow 3: persist_alerts                                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      PostgreSQL                              │
│                                                              │
│  Tables:                                                     │
│  ├── raw_transactions  - Original transaction data          │
│  ├── transactions      - Scored transactions with risk      │
│  └── alerts            - Generated fraud alerts             │
│                                                              │
│  Views:                                                      │
│  ├── fraud_rate_hourly - Current fraud rate                 │
│  ├── fraud_by_country  - Geographic distribution            │
│  └── fraud_by_pattern  - Pattern analysis                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    SAM SQL Connector
                           │
                           ▼
                    Dashboard Chat
                    "Show me high-risk transactions"
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `agent-mesh-postgresql` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | `password` | Database password |
| `POSTGRES_DATABASE` | `fraud_detection` | Database name |
| `SOLACE_BROKER_URL` | `tcp://solace:55555` | Solace broker URL |
| `SOLACE_BROKER_VPN` | `sam` | Message VPN |
| `SOLACE_BROKER_USERNAME` | `sam` | Broker username |
| `SOLACE_BROKER_PASSWORD` | `sam` | Broker password |

## Deployment

### 1. Create Queues

Create the dedicated queues on the Solace broker:

```bash
# Via SEMP API or CLI
curl -X POST "http://localhost:8080/SEMP/v2/config/msgVpns/sam/queues" \
  -u admin:admin -H "Content-Type: application/json" \
  -d '{"queueName": "fraud/q/db-raw-transactions", "accessType": "exclusive", "permission": "consume"}'

curl -X POST "http://localhost:8080/SEMP/v2/config/msgVpns/sam/queues" \
  -u admin:admin -H "Content-Type: application/json" \
  -d '{"queueName": "fraud/q/db-scored-transactions", "accessType": "exclusive", "permission": "consume"}'

curl -X POST "http://localhost:8080/SEMP/v2/config/msgVpns/sam/queues" \
  -u admin:admin -H "Content-Type: application/json" \
  -d '{"queueName": "fraud/q/db-alerts", "accessType": "exclusive", "permission": "consume"}'
```

### 2. Deploy to Kubernetes

```bash
kubectl apply -f ../k8s/database-persistence-deployment.yaml
```

### 3. Verify

Check connector logs:
```bash
kubectl logs -l app=fraud-db-persistence -f
```

Verify data in PostgreSQL:
```bash
kubectl exec -it agent-mesh-postgresql-0 -- psql -U postgres -d fraud_detection \
  -c "SELECT COUNT(*) FROM raw_transactions, transactions, alerts;"
```

## Chat Queries

Once data is persisted, use the dashboard chat to query:

- "Show me today's high-risk transactions"
- "What's the current fraud rate?"
- "Which countries have the most fraud?"
- "List blocked transactions from the last hour"
- "What patterns are most common?"

## Flows

### persist_raw_transactions
- **Input**: `fraud/q/db-raw-transactions` (subscribed to `solace/fraud/v1/transactions/inbound/>`)
- **Transform**: Maps transaction JSON to `raw_transactions` columns
- **Output**: INSERT into `raw_transactions` table

### persist_scored_transactions
- **Input**: `fraud/q/db-scored-transactions` (subscribed to `solace/fraud/v1/transactions/scored`)
- **Transform**: Maps scored transaction with risk score to `transactions` columns
- **Output**: INSERT into `transactions` table

### persist_alerts
- **Input**: `fraud/q/db-alerts` (subscribed to `solace/fraud/v1/alerts`)
- **Transform**: Handles both nested and flat alert JSON structures
- **Output**: INSERT into `alerts` table

## Troubleshooting

### No data appearing in database
1. Check connector is running: `kubectl get pods -l app=fraud-db-persistence`
2. Check connector logs for errors
3. Verify queues have subscriptions: Check in Solace admin console
4. Verify PostgreSQL connectivity: Test with `psql`

### Duplicate key errors
The connector uses `ON CONFLICT DO UPDATE` for idempotency. If you see errors:
- Check `transaction_id` or `alert_id` uniqueness
- Verify the `on_duplicate_update_columns` config
