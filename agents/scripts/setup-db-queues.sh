#!/bin/bash
# Setup queues for database persistence connector
# These queues subscribe to fraud topics and are consumed by the persistence connector

SEMP_URL="${SEMP_URL:-http://localhost:8080/SEMP/v2/config}"
VPN="${VPN:-sam}"
AUTH="${AUTH:-admin:admin}"

echo "Creating database persistence queues..."

# Queue 1: Raw transactions
echo "Creating fraud/q/db-raw-transactions..."
curl -s -X POST "${SEMP_URL}/msgVpns/${VPN}/queues" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "fraud/q/db-raw-transactions",
    "accessType": "exclusive",
    "permission": "consume",
    "ingressEnabled": true,
    "egressEnabled": true,
    "maxMsgSpoolUsage": 100,
    "maxDeliveredUnackedMsgsPerFlow": 10,
    "maxRedeliveryCount": 3
  }' | jq -r '.meta.responseCode // "created"'

# Add subscription to queue
curl -s -X POST "${SEMP_URL}/msgVpns/${VPN}/queues/fraud%2Fq%2Fdb-raw-transactions/subscriptions" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionTopic": "solace/fraud/v1/transactions/inbound/*"
  }' | jq -r '.meta.responseCode // "created"'

# Queue 2: Scored transactions
echo "Creating fraud/q/db-scored-transactions..."
curl -s -X POST "${SEMP_URL}/msgVpns/${VPN}/queues" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "fraud/q/db-scored-transactions",
    "accessType": "exclusive",
    "permission": "consume",
    "ingressEnabled": true,
    "egressEnabled": true,
    "maxMsgSpoolUsage": 100,
    "maxDeliveredUnackedMsgsPerFlow": 10,
    "maxRedeliveryCount": 3
  }' | jq -r '.meta.responseCode // "created"'

# Add subscription to queue
curl -s -X POST "${SEMP_URL}/msgVpns/${VPN}/queues/fraud%2Fq%2Fdb-scored-transactions/subscriptions" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionTopic": "solace/fraud/v1/transactions/scored"
  }' | jq -r '.meta.responseCode // "created"'

# Queue 3: Alerts
echo "Creating fraud/q/db-alerts..."
curl -s -X POST "${SEMP_URL}/msgVpns/${VPN}/queues" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "fraud/q/db-alerts",
    "accessType": "exclusive",
    "permission": "consume",
    "ingressEnabled": true,
    "egressEnabled": true,
    "maxMsgSpoolUsage": 100,
    "maxDeliveredUnackedMsgsPerFlow": 10,
    "maxRedeliveryCount": 3
  }' | jq -r '.meta.responseCode // "created"'

# Add subscription to queue
curl -s -X POST "${SEMP_URL}/msgVpns/${VPN}/queues/fraud%2Fq%2Fdb-alerts/subscriptions" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionTopic": "solace/fraud/v1/alerts"
  }' | jq -r '.meta.responseCode // "created"'

echo ""
echo "Verifying queues..."
curl -s "${SEMP_URL}/msgVpns/${VPN}/queues?select=queueName,accessType" \
  -u "$AUTH" | jq -r '.data[] | select(.queueName | startswith("fraud/q/db")) | "\(.queueName) - \(.accessType)"'

echo ""
echo "Done! Database persistence queues created."
