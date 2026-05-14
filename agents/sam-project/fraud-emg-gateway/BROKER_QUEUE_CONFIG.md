# Solace Broker Queue Configuration
# These commands configure the broker queue for durable message delivery
# with rate limiting and retry protection.

# ============================================================
# OPTION 1: SEMP CLI (SSH to broker)
# ============================================================

# Login to broker CLI
# ssh admin@<broker-host>

# Enter configure mode
enable
configure

# Navigate to queue config
message-spool
queue fraud-transactions-queue

# Set max concurrent messages (rate limiting)
# This limits how many messages can be in-flight at once
# When set to 5, only 5 messages are delivered until ACKed
max-delivered-unacked-msgs-per-flow 5

# Set max redelivery attempts (prevent infinite loops)
# After 3 failed attempts, message goes to DMQ
max-redelivery 3

# Exit and save
end
write memory

# ============================================================
# OPTION 2: SEMP API (REST)
# ============================================================

# Create/update queue with rate limiting
curl -X PATCH \
  "http://<broker-host>:8080/SEMP/v2/config/msgVpns/default/queues/fraud-transactions-queue" \
  -H "Content-Type: application/json" \
  -u "admin:admin" \
  -d '{
    "maxDeliveredUnackedMsgsPerFlow": 5,
    "maxRedeliveryCount": 3
  }'

# ============================================================
# OPTION 3: Broker Manager UI
# ============================================================
# 1. Open http://<broker-host>:8080
# 2. Navigate to Message VPN > Queues
# 3. Create or edit queue "fraud-transactions-queue"
# 4. Set:
#    - Max Delivered Unacked Msgs Per Flow: 5
#    - Max Redelivery Count: 3
# 5. Configure topic subscription: fraud/transactions/raw/>

# ============================================================
# QUEUE BINDING
# ============================================================
# The EMG gateway automatically creates a queue binding when using
# qos: 1 in subscriptions. However, for manual queue control:

# Create queue
queue fraud-transactions-queue
access-type non-exclusive
permission all
max-spool-usage 1000  # 1GB
reject-msg-to-sender-on-discard

# Add topic subscription to queue
subscription topic fraud/transactions/raw/>
no shutdown
exit

# ============================================================
# DEAD MESSAGE QUEUE (DMQ)
# ============================================================
# When nack_outcome is "failed" or max-redelivery is exceeded,
# messages go to the DMQ. Configure DMQ for inspection:

queue #dead-msg-queue
access-type non-exclusive
permission all
max-spool-usage 500  # 500MB for dead messages
no shutdown
exit

# Link source queue to DMQ
queue fraud-transactions-queue
dead-message-queue #dead-msg-queue
exit
