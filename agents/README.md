# SAM Fraud Detection Agents

AI-powered fraud detection agents deployed to **Solace Agent Mesh (SAM) Enterprise**.

## Architecture Overview

```
                    ┌─────────────────────────┐
                    │   EMG Gateway           │
                    │   (Event Mesh Gateway)  │
                    │                         │
                    │   Receives external     │
                    │   events, routes to     │
                    │   appropriate agents    │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Transaction     │   │ Alert           │   │ Orchestrator    │
│ Scorer Agent    │   │ Generator Agent │   │ (SAM Core)      │
│                 │   │                 │   │                 │
│ • Analyzes txns │   │ • Evaluates     │   │ • Routes tasks  │
│ • Assigns risk  │   │   risk scores   │   │ • Manages tools │
│ • Returns JSON  │   │ • Creates alerts│   │ • Chat handling │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

## Agents

### 1. FraudTransactionScorer

Analyzes incoming transactions and assigns risk scores using AI.

**Input Topic:** `solace/fraud/v1/transactions/inbound/>`  
**Output Topic:** `solace/fraud/v1/transactions/scored`  
**Agent ID:** `agent_019e24ab_d43f_7ec1_88a6_415223d84c45`

**Tools:**
- `score_transaction` - Analyzes transaction data and returns risk score
- `analyze_patterns` - Detects fraud patterns in transaction history

**Output Format:**
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

### 2. FraudAlertGenerator

Evaluates scored transactions and generates alerts for high-risk ones.

**Input Topic:** `solace/fraud/v1/transactions/scored`  
**Output Topic:** `solace/fraud/v1/alerts`  
**Agent ID:** `agent_019e24ac_a8cd_74b3_b1a2_234bc94ef42a`

**Tools:**
- `evaluate_alert_criteria` - Checks if transaction meets alert threshold
- `generate_alert` - Creates detailed alert with recommendations
- `publish_alert` - Sends alert to monitoring systems

**Output Format:**
```json
{
  "alert_generated": true,
  "alert": {
    "alert_id": "ALT-20260514-001",
    "severity": "high",
    "transaction_id": "TXN-ABC123",
    "risk_score": 85,
    "detected_patterns": ["card_testing"],
    "headline": "High risk transaction detected",
    "recommended_action": "block_card"
  }
}
```

## EMG Gateway Configuration

The Event Mesh Gateway routes external events to agents without requiring the orchestrator:

```yaml
# k8s/emg-gateway-configmap.yaml
event_handlers:
  - name: "score_transaction"
    subscriptions:
      - topic: "solace/fraud/v1/transactions/inbound/>"
        qos: 1  # Guaranteed delivery
    target_agent_name: "agent_019e24ab..."
    input_expression: |
      template:Analyze this financial transaction for fraud risk.
      Transaction Data: {{input.payload}}
    acknowledgment_policy:
      mode: "on_completion"  # Backpressure
      timeout_seconds: 60

  - name: "generate_alert"
    subscriptions:
      - topic: "solace/fraud/v1/transactions/scored"
        qos: 1
    target_agent_name: "agent_019e24ac..."
    payload_format: "json"
```

### Backpressure Configuration

Queues are configured to prevent overwhelming agents:

```bash
# Via configure-queues.sh script
maxDeliveredUnackedMsgsPerFlow: 1   # Process one message at a time
maxRedeliveryCount: 3               # Retry 3 times before DMQ
deadMsgQueue: "fraud/q/dead-messages"
```

## Deployment

### Prerequisites

- SAM Enterprise deployed on Kubernetes/Minikube
- Solace broker accessible
- LLM API key configured in SAM

### Deploy Agents

Agents are deployed via SAM Platform:

```bash
# Check existing agents
curl -s http://localhost:9080/agents | jq '.[] | {name, id}'

# Agents should show:
# - FraudTransactionScorer
# - FraudAlertGenerator
```

### Configure Gateway

```bash
# Apply ConfigMap
kubectl apply -f k8s/emg-gateway-configmap.yaml

# Restart gateway to pick up changes
kubectl rollout restart deployment/sam-gateway-<gateway-id>-sam-agent-gate

# Verify gateway is running
kubectl get pods | grep gateway
```

### Configure Queues

```bash
# Run the queue configuration script
./scripts/configure-queues.sh

# Verify queue settings
docker exec solace curl -s -u admin:admin \
  "http://localhost:8080/SEMP/v2/config/msgVpns/sam/queues/fraud%2Fq%2Ftransaction-scoring" \
  | jq '{queueName: .data.queueName, maxDeliveredUnackedMsgsPerFlow: .data.maxDeliveredUnackedMsgsPerFlow}'
```

## Monitoring

### Check Agent Logs

```bash
# Transaction Scorer
kubectl logs -l app=sam-agent-019e24ab... --tail=50

# Alert Generator
kubectl logs -l app=sam-agent-019e24ac... --tail=50

# Gateway
kubectl logs -l app=sam-gateway-... --tail=50 | grep -E "score|alert"
```

### Check Agent Status via SAM API

```bash
# List all agents
curl -s http://localhost:9080/agents | jq '.[].name'

# Get specific agent details
curl -s http://localhost:9080/agents/agent_019e24ab... | jq
```

## Troubleshooting

### Agent not receiving messages

1. Check gateway subscription:
```bash
kubectl logs <gateway-pod> | grep "subscription"
```

2. Verify topic pattern matches:
```
solace/fraud/v1/transactions/inbound/>  # Wildcard subscription
```

### LLM Rate Limiting

If you see "LLM service rate limit exceeded":
- Reduce transaction rate in simulator
- Check LLM quota in SAM configuration
- Consider batching or using a faster model

### Alerts showing Score 0

The LLM returns nested JSON. Frontend must extract:
```javascript
const alertData = parsed.alert || parsed;
const score = alertData.risk_score;
```

### Gateway not restarting

Force delete and reapply:
```bash
kubectl delete pod <gateway-pod>
kubectl rollout status deployment/sam-gateway-...
```

## Project Structure

```
agents/
├── k8s/
│   ├── emg-gateway-configmap.yaml  # Gateway routing config
│   ├── emg-gateway-values.yaml     # Gateway Helm values
│   ├── namespace.yaml
│   └── deployments.yaml
├── sam-project/
│   ├── fraud-detection-agents/
│   │   ├── config.yaml             # Agent definitions
│   │   └── src/
│   │       └── fraud_detection_agents/
│   │           ├── transaction_scorer_tools.py
│   │           ├── alert_generator_tools.py
│   │           └── database.py
│   ├── fraud-emg-gateway/
│   │   ├── config.yaml
│   │   └── README.md
│   └── fraud-alert-generator/
│       └── config.yaml
├── scripts/
│   └── configure-queues.sh         # Queue backpressure setup
└── README.md
```

## Environment Variables

Set these in SAM configuration or Kubernetes secrets:

| Variable | Description |
|----------|-------------|
| `SOLACE_BROKER_URL` | Broker connection URL |
| `SOLACE_BROKER_VPN` | Message VPN (default: `sam`) |
| `SOLACE_BROKER_USERNAME` | Client username |
| `SOLACE_BROKER_PASSWORD` | Client password |
| `LLM_MODEL_PROVIDER` | LLM provider (e.g., `google`) |
| `LLM_MODEL_NAME` | Model name (e.g., `gemini-flash-2`) |
