#!/bin/bash
# Configure Solace broker queues for fraud detection with backpressure
# This creates durable queues and sets up topic subscriptions

set -e

SOLACE_CONTAINER=${SOLACE_CONTAINER:-solace}
SOLACE_SEMP_URL="http://localhost:8080/SEMP/v2/config"
SOLACE_VPN="sam"
SOLACE_AUTH="admin:admin"

echo "=== Configuring Solace Queues for Fraud Detection ==="

# Queue names
SCORING_QUEUE="fraud/q/transaction-scoring"
ALERTS_QUEUE="fraud/q/alert-generation"
DMQ_QUEUE="fraud/q/dead-messages"

# Configuration
MAX_UNACKED_PER_FLOW=1    # Limits concurrent processing (backpressure) - process one at a time
MAX_REDELIVERY=3          # Max retries before moving to DMQ
MAX_SPOOL_MB=100          # Queue spool quota in MB

# Function to create a queue
create_queue() {
    local queue_name=$1
    local access_type=${2:-exclusive}  # exclusive or non-exclusive
    
    echo "Creating queue: $queue_name"
    docker exec $SOLACE_CONTAINER curl -s -X POST \
        -u $SOLACE_AUTH \
        -H "Content-Type: application/json" \
        "${SOLACE_SEMP_URL}/msgVpns/${SOLACE_VPN}/queues" \
        -d "{
            \"queueName\": \"$queue_name\",
            \"accessType\": \"$access_type\",
            \"egressEnabled\": true,
            \"ingressEnabled\": true,
            \"maxDeliveredUnackedMsgsPerFlow\": $MAX_UNACKED_PER_FLOW,
            \"maxRedeliveryCount\": $MAX_REDELIVERY,
            \"maxMsgSpoolUsage\": $MAX_SPOOL_MB,
            \"permission\": \"consume\",
            \"respectTtlEnabled\": true
        }" 2>/dev/null | jq -r '.meta.responseCode // "200"'
}

# Function to add topic subscription to queue
add_topic_subscription() {
    local queue_name=$1
    local topic=$2
    
    echo "Adding subscription '$topic' to queue '$queue_name'"
    docker exec $SOLACE_CONTAINER curl -s -X POST \
        -u $SOLACE_AUTH \
        -H "Content-Type: application/json" \
        "${SOLACE_SEMP_URL}/msgVpns/${SOLACE_VPN}/queues/$(echo $queue_name | sed 's/\//%2F/g')/subscriptions" \
        -d "{
            \"subscriptionTopic\": \"$topic\"
        }" 2>/dev/null | jq -r '.meta.responseCode // "200"'
}

# Function to set dead message queue
set_dmq() {
    local queue_name=$1
    local dmq_name=$2
    
    echo "Setting DMQ '$dmq_name' for queue '$queue_name'"
    docker exec $SOLACE_CONTAINER curl -s -X PATCH \
        -u $SOLACE_AUTH \
        -H "Content-Type: application/json" \
        "${SOLACE_SEMP_URL}/msgVpns/${SOLACE_VPN}/queues/$(echo $queue_name | sed 's/\//%2F/g')" \
        -d "{
            \"deadMsgQueue\": \"$dmq_name\"
        }" 2>/dev/null | jq -r '.meta.responseCode // "200"'
}

echo ""
echo "Step 1: Create Dead Message Queue (DMQ)"
create_queue "$DMQ_QUEUE" "non-exclusive"

echo ""
echo "Step 2: Create Transaction Scoring Queue"
create_queue "$SCORING_QUEUE" "exclusive"
add_topic_subscription "$SCORING_QUEUE" "solace/fraud/v1/transactions/inbound/>"
set_dmq "$SCORING_QUEUE" "$DMQ_QUEUE"

echo ""
echo "Step 3: Create Alert Generation Queue"
create_queue "$ALERTS_QUEUE" "exclusive"
add_topic_subscription "$ALERTS_QUEUE" "solace/fraud/v1/transactions/scored"
set_dmq "$ALERTS_QUEUE" "$DMQ_QUEUE"

echo ""
echo "=== Queue Configuration Complete ==="
echo ""
echo "Queue Summary:"
echo "  - $SCORING_QUEUE"
echo "    Subscribes to: solace/fraud/v1/transactions/inbound/>"
echo "    Max concurrent: $MAX_UNACKED_PER_FLOW"
echo "    Max redelivery: $MAX_REDELIVERY"
echo ""
echo "  - $ALERTS_QUEUE"
echo "    Subscribes to: solace/fraud/v1/transactions/scored"
echo "    Max concurrent: $MAX_UNACKED_PER_FLOW"
echo "    Max redelivery: $MAX_REDELIVERY"
echo ""
echo "  - $DMQ_QUEUE (Dead Message Queue)"
echo "    Receives failed messages after $MAX_REDELIVERY retries"
echo ""
echo "NOTE: The EMG gateway will use these queues automatically when"
echo "messages arrive on the subscribed topics."
