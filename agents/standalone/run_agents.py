"""
Standalone Fraud Detection Agents

These agents run independently and connect directly to the Solace broker.
They provide the same functionality as SAM agents but without SAM CLI dependency.

Usage:
    python run_agents.py

The agents will:
1. Subscribe to fraud/transactions/raw/>
2. Score transactions using AI/rules
3. Publish scored transactions to fraud/transactions/scored/{country}/{type}
4. Generate alerts for high-risk transactions
5. Aggregate and publish metrics
"""

import asyncio
import json
import os
import signal
import sys
import time
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

# Solace messaging
from solace.messaging.messaging_service import MessagingService
from solace.messaging.resources.topic import Topic
from solace.messaging.resources.topic_subscription import TopicSubscription
from solace.messaging.receiver.message_receiver import MessageHandler, InboundMessage


class CallbackHandler(MessageHandler):
    """Wrapper to use a callback function as a MessageHandler"""
    def __init__(self, callback):
        self.callback = callback
        
    def on_message(self, message: InboundMessage):
        self.callback(message)


def parse_solace_message(message) -> dict:
    """Parse a Solace message, handling binary protocol headers and trailers."""
    # Try string first
    payload = message.get_payload_as_string()
    if payload is None:
        # Try bytes
        raw = message.get_payload_as_bytes()
        if raw:
            # Decode with error handling
            payload = raw.decode('utf-8', errors='ignore')
    
    if not payload:
        return None
    
    # Find JSON start (skip any binary protocol bytes)
    json_start = payload.find('{')
    if json_start == -1:
        json_start = payload.find('[')
    if json_start == -1:
        return None
    
    # Find JSON end by matching braces (skip trailing bytes)
    s = payload[json_start:]
    open_char = s[0]
    close_char = '}' if open_char == '{' else ']'
    depth = 0
    in_string = False
    escape = False
    json_end = len(s)
    
    for i, c in enumerate(s):
        if escape:
            escape = False
            continue
        if c == '\\' and in_string:
            escape = True
            continue
        if c == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == open_char:
            depth += 1
        elif c == close_char:
            depth -= 1
            if depth == 0:
                json_end = i + 1
                break
    
    return json.loads(s[:json_end])

# Optional: LiteLLM for AI scoring
try:
    from litellm import completion
    LITELLM_AVAILABLE = True
except ImportError:
    LITELLM_AVAILABLE = False
    print("[WARNING] LiteLLM not available, using rule-based scoring only")


class SolaceConnection:
    """Manages Solace broker connection"""
    
    def __init__(self):
        self.host = os.getenv("SOLACE_HOST", "ws://localhost:8008")
        self.vpn = os.getenv("SOLACE_VPN", "default")
        self.username = os.getenv("SOLACE_USERNAME", "demo")
        self.password = os.getenv("SOLACE_PASSWORD", "demo")
        self.messaging_service = None
        self.publisher = None
        
    def connect(self):
        """Connect to Solace broker"""
        self.messaging_service = MessagingService.builder() \
            .from_properties({
                "solace.messaging.transport.host": self.host,
                "solace.messaging.service.vpn-name": self.vpn,
                "solace.messaging.authentication.scheme.basic.username": self.username,
                "solace.messaging.authentication.scheme.basic.password": self.password,
            }) \
            .build()
        self.messaging_service.connect()
        
        self.publisher = self.messaging_service.create_direct_message_publisher_builder().build()
        self.publisher.start()
        
        print(f"[SolaceConnection] Connected to {self.host}")
        return self
    
    def publish(self, topic: str, payload: Dict[str, Any]):
        """Publish message to topic"""
        message_builder = self.messaging_service.message_builder()
        message = message_builder.with_application_message_id(str(uuid4())).build(json.dumps(payload))
        self.publisher.publish(message, Topic.of(topic))
    
    def subscribe(self, topic_pattern: str, handler_callback):
        """Subscribe to topic pattern"""
        receiver = self.messaging_service.create_direct_message_receiver_builder() \
            .with_subscriptions([TopicSubscription.of(topic_pattern)]) \
            .build()
        receiver.start()
        handler = CallbackHandler(handler_callback)
        receiver.receive_async(handler)
        return receiver
    
    def disconnect(self):
        """Disconnect from broker"""
        if self.publisher:
            self.publisher.terminate()
        if self.messaging_service:
            self.messaging_service.disconnect()
        print("[SolaceConnection] Disconnected")


class TransactionScorer:
    """Scores transactions for fraud risk"""
    
    def __init__(self, solace: SolaceConnection):
        self.solace = solace
        self.model = os.getenv("LITELLM_MODEL", "gpt-4o-mini")
        self.use_ai = LITELLM_AVAILABLE and os.getenv("LITELLM_API_KEY")
        self.total_scored = 0
        self.total_fraud = 0
        
    def start(self):
        """Start processing transactions"""
        self.solace.subscribe("fraud/transactions/raw/>", self._handle_message)
        print("[TransactionScorer] Subscribed to fraud/transactions/raw/>")
        
    def _handle_message(self, message):
        """Handle incoming raw transaction"""
        try:
            transaction = parse_solace_message(message)
            if not transaction:
                return
            
            # Debug: print first transaction to see fields
            if self.total_scored == 0:
                print(f"[TransactionScorer] Sample tx keys: {list(transaction.keys())}")
                print(f"[TransactionScorer] _fraud_label: {transaction.get('_fraud_label')}, amount: {transaction.get('amount')}, velocity: {transaction.get('velocity')}")
            
            # Score the transaction
            scored = self._score_transaction(transaction)
            
            # Debug: print first scored result
            if self.total_scored == 0:
                print(f"[TransactionScorer] Scored result: score={scored.get('risk_score')}, patterns={scored.get('detected_patterns')}")
            
            # Publish scored transaction
            merchant = transaction.get("merchant", {})
            country = merchant.get("country", "XX")
            tx_type = transaction.get("type", "purchase")
            topic = f"fraud/transactions/scored/{country}/{tx_type}"
            
            self.solace.publish(topic, scored)
            
            self.total_scored += 1
            if scored.get("risk_score", 0) >= 70:
                self.total_fraud += 1
                
        except Exception as e:
            print(f"[TransactionScorer] Error: {e}")
    
    def _score_transaction(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Score transaction using AI or rules"""
        if self.use_ai:
            return self._score_with_ai(transaction)
        return self._score_with_rules(transaction)
    
    def _score_with_ai(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Score using LiteLLM"""
        try:
            prompt = f"""Analyze this transaction for fraud risk.

Transaction: {json.dumps(transaction, indent=2)}

Respond with JSON only:
{{"risk_score": 0-100, "confidence": 0.0-1.0, "decision": "approved|review|blocked", "detected_patterns": [], "reasoning": "..."}}"""

            response = completion(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=300,
            )
            
            ai_result = json.loads(response.choices[0].message.content)
            
            return {
                **transaction,
                "risk_score": ai_result.get("risk_score", 50),
                "confidence": ai_result.get("confidence", 0.5),
                "decision": ai_result.get("decision", "review"),
                "detected_patterns": ai_result.get("detected_patterns", []),
                "reasoning": ai_result.get("reasoning", ""),
                "scored_at": datetime.now(timezone.utc).isoformat(),
                "agent": "transaction-scorer",
                "scoring_method": "ai",
            }
        except Exception as e:
            print(f"[TransactionScorer] AI scoring failed: {e}")
            return self._score_with_rules(transaction)
    
    def _score_with_rules(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Score using rule-based logic"""
        score = 0
        factors = {}
        patterns = []
        
        # Check for fraud label from generator (boosted detection)
        if transaction.get("_fraud_label"):
            score += 50
            factors["fraud_label"] = 0.50
            patterns.append(transaction.get("_fraud_pattern", "Flagged Transaction"))
        
        # Amount analysis
        amount = transaction.get("amount", 0)
        if amount > 5000:
            score += 25
            factors["high_amount"] = 0.25
            patterns.append("Amount Anomaly")
        elif amount < 5:
            score += 30
            factors["micro_amount"] = 0.30
            patterns.append("Card Testing")
        
        # Velocity analysis
        velocity = transaction.get("velocity", {})
        txns_last_hour = velocity.get("txns_last_hour", 0)
        if txns_last_hour > 5:
            score += 35
            factors["high_velocity"] = 0.35
            patterns.append("Velocity Abuse")
        
        # Device analysis
        device = transaction.get("device", {})
        if device.get("is_new", False) or device.get("fingerprint_new", False):
            score += 20
            factors["new_device"] = 0.20
            patterns.append("Account Takeover")
        
        if device.get("vpn_detected", False):
            score += 15
            factors["vpn_usage"] = 0.15
            patterns.append("VPN Detected")
        
        # Geographic analysis
        merchant = transaction.get("merchant", {})
        country = merchant.get("country", "")
        if country in ["NG", "RU", "CN", "UA"]:
            score += 20
            factors["high_risk_country"] = 0.20
            patterns.append("Geographic Anomaly")
        
        # Merchant analysis
        category = merchant.get("category", "").lower()
        if category in ["gambling", "crypto", "wire_transfer", "money_order"]:
            score += 15
            factors["high_risk_merchant"] = 0.15
            patterns.append("High-Risk Merchant")
        
        score = min(score, 100)
        
        if score >= 80:
            decision = "blocked"
        elif score >= 50:
            decision = "review"
        else:
            decision = "approved"
        
        reasoning = f"Rule-based scoring: {', '.join(patterns)}" if patterns else "No risk patterns detected"
        
        return {
            **transaction,
            "risk_score": score,
            "confidence": 0.85 if patterns else 0.95,
            "decision": decision,
            "detected_patterns": patterns,
            "factors": factors,
            "reasoning": reasoning,
            "scored_at": datetime.now(timezone.utc).isoformat(),
            "agent": "transaction-scorer",
            "scoring_method": "rules",
        }


class AlertGenerator:
    """Generates alerts for high-risk transactions"""
    
    def __init__(self, solace: SolaceConnection):
        self.solace = solace
        self.threshold = int(os.getenv("ALERT_THRESHOLD", "70"))
        self.alerts_generated = 0
        self.processed_txns = set()  # Track processed transaction IDs to prevent duplicates
        
    def start(self):
        """Start processing scored transactions"""
        self.solace.subscribe("fraud/transactions/scored/>", self._handle_message)
        print(f"[AlertGenerator] Subscribed to fraud/transactions/scored/> (threshold: {self.threshold})")
        
    def _handle_message(self, message):
        """Handle incoming scored transaction"""
        try:
            transaction = parse_solace_message(message)
            if not transaction:
                return
            
            # Deduplicate - skip if we've already processed this transaction
            txn_id = transaction.get("transaction_id")
            if txn_id in self.processed_txns:
                return
            self.processed_txns.add(txn_id)
            # Limit memory usage - keep only last 1000 IDs
            if len(self.processed_txns) > 1000:
                self.processed_txns = set(list(self.processed_txns)[-500:])
            
            risk_score = transaction.get("risk_score", 0)
            
            # Only generate alerts for high-risk
            if risk_score < self.threshold:
                return
            
            # Determine severity
            if risk_score >= 90:
                severity = "critical"
            elif risk_score >= 80:
                severity = "high"
            else:
                severity = "medium"
            
            # Generate alert
            patterns = transaction.get("detected_patterns", [])
            merchant = transaction.get("merchant", {})
            amount = transaction.get("amount", 0)
            
            primary_pattern = patterns[0] if patterns else "High Risk"
            merchant_name = merchant.get("name", "Unknown")
            
            headlines = {
                "critical": f"🚨 CRITICAL: {primary_pattern} - ${amount:.2f} at {merchant_name}",
                "high": f"⚠️ HIGH RISK: {primary_pattern} - ${amount:.2f}",
                "medium": f"⚡ ALERT: {primary_pattern} pattern - ${amount:.2f}",
            }
            
            alert = {
                "id": f"ALT-{uuid4().hex[:12].upper()}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "severity": severity,
                "headline": headlines.get(severity, headlines["medium"])[:80],
                "transaction_id": transaction.get("transaction_id"),
                "score": risk_score,
                "pattern": primary_pattern,
                "patterns": patterns,
                "amount": amount,
                "currency": transaction.get("currency", "USD"),
                "merchant": merchant_name,
                "merchant_category": merchant.get("category", "Unknown"),
                "country": merchant.get("country", "XX"),
                "reasoning": transaction.get("reasoning", ""),
                "decision": transaction.get("decision", "review"),
                "agent": "alert-generator",
            }
            
            self.solace.publish(f"fraud/alerts/{severity}", alert)
            self.alerts_generated += 1
            
            print(f"[AlertGenerator] {severity.upper()}: {alert['headline'][:60]}")
            
        except Exception as e:
            print(f"[AlertGenerator] Error: {e}")


class MetricsAggregator:
    """Aggregates transaction metrics"""
    
    def __init__(self, solace: SolaceConnection):
        self.solace = solace
        self.publish_interval = int(os.getenv("METRICS_INTERVAL", "1"))
        
        # Metrics storage
        self.total_transactions = 0
        self.fraud_detected = 0
        self.total_blocked = 0
        self.total_approved = 0
        self.total_review = 0
        self.total_amount = 0.0
        self.fraud_amount = 0.0
        self.risk_score_sum = 0
        self.pattern_counts = defaultdict(int)
        self.country_counts = defaultdict(int)
        self.risk_distribution = defaultdict(int)
        
        self.start_time = datetime.now(timezone.utc)
        self.last_publish = datetime.now(timezone.utc)
        
    def start(self):
        """Start processing scored transactions"""
        self.solace.subscribe("fraud/transactions/scored/>", self._handle_message)
        print("[MetricsAggregator] Subscribed to fraud/transactions/scored/>")
        
    def _handle_message(self, message):
        """Handle incoming scored transaction"""
        try:
            transaction = parse_solace_message(message)
            if not transaction:
                return
            
            # Update metrics
            self.total_transactions += 1
            
            amount = transaction.get("amount", 0)
            self.total_amount += amount
            
            risk_score = transaction.get("risk_score", 0)
            self.risk_score_sum += risk_score
            
            # Risk bucket
            bucket = (risk_score // 10) * 10
            self.risk_distribution[bucket] += 1
            
            # Fraud detection
            if risk_score >= 70:
                self.fraud_detected += 1
                self.fraud_amount += amount
            
            # Decision tracking
            decision = transaction.get("decision", "unknown")
            if decision == "blocked":
                self.total_blocked += 1
            elif decision == "approved":
                self.total_approved += 1
            elif decision == "review":
                self.total_review += 1
            
            # Pattern tracking
            for pattern in transaction.get("detected_patterns", []):
                self.pattern_counts[pattern] += 1
            
            # Geographic tracking
            merchant = transaction.get("merchant", {})
            country = merchant.get("country", "XX")
            self.country_counts[country] += 1
            
            # Publish metrics periodically
            now = datetime.now(timezone.utc)
            if (now - self.last_publish).total_seconds() >= self.publish_interval:
                self._publish_metrics()
                self.last_publish = now
                
        except Exception as e:
            print(f"[MetricsAggregator] Error: {e}")
    
    def _publish_metrics(self):
        """Publish aggregated metrics"""
        now = datetime.now(timezone.utc)
        uptime = (now - self.start_time).total_seconds()
        
        total = max(self.total_transactions, 1)
        tps = total / max(uptime, 1)
        fraud_rate = (self.fraud_detected / total) * 100
        avg_risk = self.risk_score_sum / total
        avg_amount = self.total_amount / total
        
        # Top patterns
        top_patterns = sorted(self.pattern_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        top_countries = sorted(self.country_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        
        # Risk distribution
        risk_dist = [{"range": f"{k}-{k+9}", "count": v} for k, v in sorted(self.risk_distribution.items())]
        
        metrics = {
            "timestamp": now.isoformat(),
            "uptime_seconds": round(uptime, 1),
            "total_transactions": self.total_transactions,
            "transactions_per_second": round(tps, 2),
            "fraud_detected": self.fraud_detected,
            "fraud_rate_percent": round(fraud_rate, 2),
            "fraud_amount": round(self.fraud_amount, 2),
            "decisions": {
                "approved": self.total_approved,
                "blocked": self.total_blocked,
                "review": self.total_review,
            },
            "total_amount": round(self.total_amount, 2),
            "average_amount": round(avg_amount, 2),
            "average_risk_score": round(avg_risk, 1),
            "risk_distribution": risk_dist,
            "top_patterns": [{"pattern": p, "count": c} for p, c in top_patterns],
            "top_countries": [{"country": c, "count": n} for c, n in top_countries],
            "agent": "metrics-aggregator",
        }
        
        self.solace.publish("fraud/metrics/aggregates", metrics)


async def main():
    """Run all fraud detection agents"""
    print("=" * 60)
    print("  Fraud Detection Agents - Standalone Mode")
    print("=" * 60)
    print()
    
    # Connect to Solace
    solace = SolaceConnection().connect()
    
    # Start agents
    scorer = TransactionScorer(solace)
    scorer.start()
    
    alerts = AlertGenerator(solace)
    alerts.start()
    
    metrics = MetricsAggregator(solace)
    metrics.start()
    
    print()
    print("[Agents] All agents started. Waiting for transactions...")
    print("[Agents] Press Ctrl+C to stop")
    print()
    
    # Handle shutdown
    def shutdown(signum, frame):
        print("\n[Agents] Shutting down...")
        solace.disconnect()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    
    # Keep running
    while True:
        await asyncio.sleep(10)
        print(f"[Status] Scored: {scorer.total_scored}, Fraud: {scorer.total_fraud}, Alerts: {alerts.alerts_generated}")


if __name__ == "__main__":
    asyncio.run(main())
