# Fraud Detection Agents - SAM Plugin

Real-time fraud detection agents for Solace Agent Mesh.

## Agents

1. **fraud-transaction-scorer** - AI-powered risk scoring using LLM
2. **fraud-alert-generator** - Generates alerts for high-risk transactions  
3. **fraud-metrics-aggregator** - Real-time metrics aggregation

## Installation

```bash
# Build the plugin
cd fraud-detection-agents
sam plugin build

# Add to your SAM project
sam plugin add fraud-detection-agents --plugin dist/fraud_detection_agents-1.0.0-py3-none-any.whl

# Run
sam run
```

## Topics

- Input: `fraud/transactions/raw/>`
- Scored: `fraud/transactions/scored/{country}/{type}`
- Alerts: `fraud/alerts/{severity}`
- Metrics: `fraud/metrics/aggregates`
