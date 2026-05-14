# Fraud Detection Event Mesh Gateway

This SAM Event Mesh Gateway provides at-least-once delivery for fraud transaction processing with the `acknowledgment_policy` set to `on_completion`.

Based on the official [sam-event-mesh-gateway plugin](https://github.com/SolaceLabs/solace-agent-mesh-core-plugins/tree/main/sam-event-mesh-gateway).

## Features

- **Deferred Acknowledgment**: Messages stay in queue until processing completes (`mode: "on_completion"`)
- **Automatic Retry**: Failed messages are NACKed and redelivered by the broker
- **Chat Handler**: Routes dashboard chat messages to the Orchestrator
- **Transaction Handler**: Routes raw transactions through the full scoring pipeline

## Prerequisites

1. SAM CLI installed:
   ```bash
   pip install solace-agent-mesh
   ```

2. SAM Event Mesh Gateway plugin:
   ```bash
   sam plugin add fraud-emg-gateway --plugin sam-event-mesh-gateway
   ```

3. Environment variables configured (see `.env.example`)

## Quick Start

1. Copy environment file:
   ```bash
   cp .env.example .env
   # Edit .env with your Solace broker credentials
   ```

2. Source environment:
   ```bash
   source .env
   ```

3. Run the gateway:
   ```bash
   sam run config.yaml
   ```

## Configuration Options

### Acknowledgment Policy

| Setting | Value | Description |
|---------|-------|-------------|
| `mode` | `on_completion` | ACK only after task completes successfully |
| `on_failure.action` | `nack` | Negatively acknowledge failed messages |
| `on_failure.nack_outcome` | `rejected` | Redeliver failed messages |
| `timeout_seconds` | `300` | 5 minute timeout per task |

### Rate Limiting (Broker-side)

Configure the Solace broker queue to control concurrency:

```bash
# Allow only 5 concurrent messages per flow
solace(configure/message-spool/queue)# max-delivered-unacked-msgs-per-flow 5

# Prevent infinite retry loops (move to DMQ after 3 attempts)
solace(configure/message-spool/queue)# max-redelivery 3
```

### Alternative Failure Modes

**Send to DLQ instead of retry:**
```yaml
acknowledgment_policy:
  mode: "on_completion"
  on_failure:
    action: "nack"
    nack_outcome: "failed"  # Move to Dead Letter Queue
```

**Discard failed messages:**
```yaml
acknowledgment_policy:
  mode: "on_completion"
  on_failure:
    action: "ack"  # ACK even on failure (message discarded)
```

## Topics

| Topic | Direction | Description |
|-------|-----------|-------------|
| `fraud/chat/request` | Subscribe | Chat requests from dashboard |
| `fraud/chat/response` | Publish | Chat responses |
| `fraud/chat/error` | Publish | Chat errors |
| `fraud/transactions/raw/>` | Subscribe | Raw transactions (wildcard) |
| `fraud/transactions/processed/scored` | Publish | Scored transactions |
| `fraud/transactions/errors/{id}` | Publish | Transaction errors |

## Architecture

```
Dashboard/Simulator
       │
       ▼ (publish)
   Solace Broker
       │
       ▼ (subscribe: fraud/transactions/raw/>)
┌──────────────────────────────────────────┐
│  Event Mesh Gateway                      │
│  - Deferred ACK (on_completion)         │
│  - At-least-once delivery               │
│  - 5 min timeout                        │
└──────────────────────────────────────────┘
       │
       ▼ (A2A request)
  OrchestratorAgent
       │
       ├──▶ FraudTransactionScorer (score)
       ├──▶ FraudAlertGenerator (if high risk)
       └──▶ FraudMetricsAggregator (update metrics)
       │
       ▼ (A2A response)
  Event Mesh Gateway
       │
       ▼ (publish: fraud/transactions/processed/scored)
   Solace Broker
       │
       ▼ (subscribe)
     Dashboard
```

## Deploying to Kubernetes

The gateway can also be deployed to K8s using the SAM Agent Deployer:

```bash
# From the project root
kubectl apply -f agents/k8s/fraud-emg-gateway-deployment.yaml
```

Or via the SAM UI by creating a new Event Mesh Gateway and pasting the config.
