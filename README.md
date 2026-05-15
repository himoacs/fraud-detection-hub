# Fraud Detection Hub

Real-time AI-powered fraud detection demo powered by **Solace Agent Mesh (SAM)**.

Built for **Demothon FY2027** - showcasing Event Mesh + Agentic AI.

## 🎯 Demo Highlights

- **Real-time transaction monitoring** at 1-100+ TPS
- **AI-powered fraud scoring** using LLM (Gemini Flash / GPT-4)
- **5 fraud patterns**: Card Testing, Account Takeover, Velocity Abuse, Geo Anomaly, Amount Spike
- **Live dashboard** with Solace branding
- **Interactive chat** with SAM for fraud insights
- **Queue-based backpressure** for reliable processing

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Dashboard (Next.js @ localhost:3000)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Metrics  │ │ Charts   │ │ Alerts   │ │ TxFeed   │ │ SAM Chat │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │            │            │            │             │                │
│       └────────────┴────────────┴────────────┴─────────────┘                │
│                              │ WebSocket                                     │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Solace Event Broker (Docker @ localhost:8008)             │
│                                                                              │
│  Topics:                                                                     │
│  ├── solace/fraud/v1/transactions/inbound/{country}/{type}  ← Simulator     │
│  ├── solace/fraud/v1/transactions/scored                    ← Scorer Agent  │
│  └── solace/fraud/v1/alerts                                 ← Alert Agent   │
│                                                                              │
│  Queues (backpressure):                                                      │
│  ├── fraud/q/transaction-scoring    maxUnacked=1, maxRedelivery=3           │
│  └── fraud/q/alert-generation       maxUnacked=1, maxRedelivery=3           │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  EMG Gateway  │────▶│  Transaction  │────▶│    Alert      │
│               │     │    Scorer     │     │  Generator    │
│  Routes msgs  │     │   (LLM AI)    │     │   (LLM AI)    │
│  to agents    │     │               │     │               │
└───────────────┘     └───────────────┘     └───────────────┘
        │                    │                      │
        └────────────────────┴──────────────────────┘
                             │
              ┌──────────────────────────┐
              │  Solace Agent Mesh (SAM) │
              │   Enterprise Edition     │
              │     (Minikube/K8s)       │
              │                          │
              │  Platform: localhost:9080│
              │  Core API: localhost:9000│
              └──────────────────────────┘
```

## 📦 Components

### Frontend Dashboard
- **Next.js 15** with App Router
- **Solace WebSocket client** for real-time subscriptions
- **Recharts** for live visualizations
- **SAM Chat integration** for conversational insights

### SAM Agents

| Agent | Purpose | Input Topic | Output Topic |
|-------|---------|-------------|--------------|
| **FraudTransactionScorer** | AI-powered risk scoring | `solace/fraud/v1/transactions/inbound/>` | `solace/fraud/v1/transactions/scored` |
| **FraudAlertGenerator** | Alert creation for high-risk txns | `solace/fraud/v1/transactions/scored` | `solace/fraud/v1/alerts` |

### EMG Gateway
The Event Mesh Gateway routes external events to SAM agents:
- Receives transactions from simulator
- Routes to scorer agent with `qos: 1` (guaranteed delivery)
- Implements `acknowledgment_policy: on_completion` for backpressure

## 🚀 Quick Start

### Prerequisites
- Docker Desktop with Kubernetes
- Minikube with SAM Enterprise deployed
- Node.js 18+

### 1. Start Solace Broker
```bash
docker run -d --name solace \
  -p 8008:8008 -p 8080:8080 -p 55554:55555 \
  solace/solace-pubsub-standard:latest
```

### 2. Deploy SAM Agents
```bash
# Configure queues with backpressure
./agents/scripts/configure-queues.sh

# Apply gateway configuration
kubectl apply -f agents/k8s/emg-gateway-configmap.yaml
kubectl rollout restart deployment/sam-gateway-...
```

### 3. Start Dashboard
```bash
npm install
npm run dev
# Open http://localhost:3000
```

### 4. Run the Demo
1. Click **Start** to begin generating transactions
2. Watch transactions flow through in real-time
3. AI scores each transaction (1-2s latency)
4. High-risk transactions (≥70) generate alerts
5. Use **Chat** to ask SAM questions about fraud patterns

## 🔧 API Reference

### Simulator Controls

```bash
# Start simulator
curl -X POST http://localhost:3000/api/simulator/start \
  -H "Content-Type: application/json" \
  -d '{"rate": 1}'

# Stop simulator
curl -X POST http://localhost:3000/api/simulator/stop

# Adjust rate (transactions per second)
curl -X POST http://localhost:3000/api/simulator/rate \
  -H "Content-Type: application/json" \
  -d '{"rate": 0.5}'

# Get stats
curl http://localhost:3000/api/simulator/stats

# Inject specific fraud pattern
curl -X POST http://localhost:3000/api/simulator/inject \
  -H "Content-Type: application/json" \
  -d '{"pattern": "card_testing"}'
```

### Fraud Patterns

| Pattern | Description | Typical Score |
|---------|-------------|---------------|
| `card_testing` | Multiple small amounts testing card validity | 80-95 |
| `account_takeover` | New device + unusual location | 85-95 |
| `velocity_abuse` | Too many transactions too fast | 75-90 |
| `geo_anomaly` | Impossible travel patterns | 80-90 |
| `high_amount` | Unusually large transaction amounts | 70-85 |

## 📊 Message Formats

### Transaction (Inbound)
```json
{
  "transaction_id": "TXN-ABC123",
  "timestamp": "2026-05-14T19:30:00Z",
  "amount": 299.99,
  "currency": "USD",
  "type": "card_not_present",
  "merchant": {
    "name": "Digital Store",
    "category": "digital_goods",
    "country": "US"
  },
  "customer": {
    "id": "CUST-001",
    "account_age_days": 30,
    "risk_tier": "medium"
  },
  "device": {
    "type": "mobile",
    "ip": "192.168.1.1",
    "is_new": true
  },
  "velocity": {
    "txns_last_hour": 5,
    "txns_last_day": 20,
    "amount_last_day": 1500
  }
}
```

### Scored Transaction (Output)
```json
{
  "transaction_id": "TXN-ABC123",
  "risk_score": 75,
  "risk_level": "high",
  "decision": "review",
  "detected_patterns": ["velocity_abuse", "new_device"],
  "reasoning": "High transaction velocity combined with new device..."
}
```

### Alert (Output)
```json
{
  "alert_generated": true,
  "alert": {
    "alert_id": "ALT-20260514-001",
    "severity": "high",
    "transaction_id": "TXN-ABC123",
    "risk_score": 85,
    "detected_patterns": ["card_testing", "high_velocity"],
    "headline": "High risk transaction detected",
    "recommended_action": "contact_customer"
  }
}
```

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLACE_BROKER_URL` | `ws://localhost:8008` | Solace broker WebSocket URL |
| `SOLACE_BROKER_VPN` | `sam` | Message VPN name |
| `SAM_PLATFORM_URL` | `http://localhost:9080` | SAM Platform API |
| `SAM_CORE_URL` | `http://localhost:9000` | SAM Core API |

### Gateway Configuration

The EMG gateway is configured via ConfigMap:

```yaml
# agents/k8s/emg-gateway-configmap.yaml
event_handlers:
  - name: "score_transaction"
    subscriptions:
      - topic: "solace/fraud/v1/transactions/inbound/>"
        qos: 1  # Guaranteed delivery
    target_agent_name: "agent_019e24ab..."
    acknowledgment_policy:
      mode: "on_completion"  # Backpressure: hold until agent completes
      timeout_seconds: 60
```

### Backpressure Settings

Explicit queues are configured with flow control:
```bash
# Set via SEMP API
maxDeliveredUnackedMsgsPerFlow: 1  # Process one at a time
maxRedeliveryCount: 3              # Retry before DMQ
deadMsgQueue: "fraud/q/dead-messages"
```

## 🔍 Troubleshooting

### Alerts showing "Score 0"
The LLM returns nested JSON structure. Ensure frontend parses:
```js
const alertData = parsed.alert || parsed;
const score = alertData.risk_score || 0;
```

### LLM Rate Limiting
At high TPS, the LLM provider may rate limit:
```
The LLM service rate limit has been exceeded
```
**Solution**: Reduce simulator rate or upgrade LLM quota.

### Gateway not receiving messages
Check gateway subscriptions:
```bash
kubectl logs -l app=sam-gateway-... | grep "subscription"
```

### Check agent status
```bash
kubectl get pods | grep sam-agent
kubectl logs sam-agent-... --tail=50
```

### Access SAM UI
**Note:** Port 8000 is used by the Solace broker container. The SAM UI frontend expects the API at `localhost:8000`, causing a conflict when both are running.

**Workaround:** Stop the Solace broker temporarily or access SAM UI from a separate environment.

```bash
# UI only (limited functionality without API):
kubectl port-forward -n default svc/agent-mesh-solace-agent-mesh-core 8888:80

# Then open http://localhost:8888
```

## �️ Database Persistence

The fraud detection system persists all events to PostgreSQL for analytics and SAM agent SQL queries.

### Architecture

```
Solace Queues                    PostgreSQL Tables
┌──────────────────────────┐     ┌──────────────────────────┐
│ fraud/q/db-raw-transactions  ──▶ │ raw_transactions         │
├──────────────────────────┤     ├──────────────────────────┤
│ fraud/q/db-scored-transactions ─▶│ scored_transactions      │
├──────────────────────────┤     ├──────────────────────────┤
│ fraud/q/db-alerts        │ ──▶ │ alerts                   │
└──────────────────────────┘     └──────────────────────────┘
```

### Tables Overview

| Table | Key Fields | Purpose |
|-------|------------|---------|
| `raw_transactions` | transaction_id, amount, merchant_name, country | Incoming transactions |
| `scored_transactions` | risk_score, risk_level, decision, detected_patterns | AI-scored results |
| `alerts` | alert_generated, severity, alert_type, reason | Generated alerts |

### Start Persistence Service

```bash
# Build and run
cd agents/docker-micro-integration
docker build -f Dockerfile.persistence -t fraud-persistence:latest .
docker run -d --name fraud-db-persistence \
  --network demo-net \
  -e SOLACE_BROKER_URL=ws://solace:8008 \
  -e POSTGRES_HOST=host.docker.internal \
  fraud-persistence:latest
```

### Example Queries

```sql
-- High-risk blocked transactions
SELECT r.transaction_id, r.amount, s.risk_score, s.decision
FROM raw_transactions r
JOIN scored_transactions s ON r.transaction_id = s.transaction_id
WHERE s.decision = 'blocked';

-- Fraud patterns by country
SELECT r.country, unnest(s.detected_patterns) as pattern, COUNT(*)
FROM raw_transactions r
JOIN scored_transactions s ON r.transaction_id = s.transaction_id
GROUP BY r.country, pattern;

-- Recent high-severity alerts
SELECT transaction_id, alert_type, severity
FROM alerts
WHERE alert_generated = true AND severity = 'high';
```

📖 **Full documentation**: See [agents/docker-micro-integration/README.md](agents/docker-micro-integration/README.md)

## �📁 Project Structure

```
fraud-detection-hub/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── api/
│   │   │   ├── chat/             # SAM chat integration
│   │   │   └── simulator/        # Simulator control APIs
│   │   └── page.tsx              # Main dashboard
│   ├── components/
│   │   ├── ui/
│   │   │   ├── ChatWindow.tsx    # SAM chat interface
│   │   │   ├── SimulatorControls.tsx
│   │   │   ├── TransactionFeed.tsx
│   │   │   └── AlertCard.tsx
│   │   └── charts/
│   ├── hooks/
│   │   ├── useSimulatorSAM.ts    # SAM mode simulator hook
│   │   └── useSolaceSubscription.ts
│   ├── lib/
│   │   ├── simulator/            # Transaction generator
│   │   └── solace/               # Solace WebSocket client
│   └── types/
│
├── agents/
│   ├── k8s/                      # Kubernetes manifests
│   │   ├── emg-gateway-configmap.yaml
│   │   └── emg-gateway-values.yaml
│   ├── sam-project/              # SAM agent definitions
│   │   ├── fraud-detection-agents/
│   │   ├── fraud-emg-gateway/
│   │   └── fraud-alert-generator/
│   ├── docker-micro-integration/ # Database persistence
│   │   ├── README.md             # Full documentation
│   │   ├── persistence_service.py
│   │   └── Dockerfile.persistence
│   └── scripts/
│       └── configure-queues.sh   # Queue backpressure setup
│
└── README.md
```

## 📝 License

Internal Solace demo - Demothon FY2027
