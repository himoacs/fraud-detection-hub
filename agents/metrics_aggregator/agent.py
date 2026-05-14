"""
Metrics Aggregator Agent for SAM Enterprise

This agent collects scored transactions and publishes
real-time aggregate metrics to the dashboard.
"""

import json
import os
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Any
import asyncio

from solace_agent_mesh import Agent, AgentConfig, Message

config = AgentConfig(
    name="metrics-aggregator",
    description="Aggregates fraud metrics in real-time",
    subscriptions=["fraud/transactions/scored/>"],
    publications=["fraud/metrics/aggregates", "fraud/metrics/summary"],
)


class MetricsAggregatorAgent(Agent):
    """Agent that aggregates transaction metrics"""

    def __init__(self):
        super().__init__(config)
        self.publish_interval = int(os.getenv("METRICS_INTERVAL_SECONDS", "1"))
        
        # Metrics storage
        self.reset_metrics()
        
        # Start periodic publishing
        self.last_publish = datetime.utcnow()

    def reset_metrics(self):
        """Reset all metrics counters"""
        self.total_transactions = 0
        self.total_fraud_detected = 0
        self.total_blocked = 0
        self.total_amount = 0.0
        self.fraud_amount = 0.0
        
        # Distribution tracking
        self.risk_distribution = defaultdict(int)
        self.decision_counts = defaultdict(int)
        self.pattern_counts = defaultdict(int)
        self.country_counts = defaultdict(int)
        self.category_counts = defaultdict(int)
        
        # Time series (last 60 seconds)
        self.second_data = []
        
        # Score sums for averaging
        self.risk_score_sum = 0
        self.confidence_sum = 0.0

    async def process_message(self, message: Message) -> None:
        """Process scored transaction and update metrics"""
        try:
            transaction = json.loads(message.payload)
            self.update_metrics(transaction)
            
            # Publish metrics every interval
            now = datetime.utcnow()
            if (now - self.last_publish).total_seconds() >= self.publish_interval:
                await self.publish_metrics()
                self.last_publish = now
                
        except Exception as e:
            self.logger.error(f"Error processing metrics: {e}")

    def update_metrics(self, transaction: dict) -> None:
        """Update metrics from a single transaction"""
        self.total_transactions += 1
        
        amount = transaction.get("amount", 0)
        risk_score = transaction.get("risk_score", 0)
        decision = transaction.get("decision", "unknown")
        patterns = transaction.get("detected_patterns", [])
        merchant = transaction.get("merchant", {})
        
        # Amount tracking
        self.total_amount += amount
        
        # Risk metrics
        self.risk_score_sum += risk_score
        self.confidence_sum += transaction.get("confidence", 0)
        
        # Fraud detection
        if risk_score >= 70:
            self.total_fraud_detected += 1
            self.fraud_amount += amount
        
        if decision == "blocked":
            self.total_blocked += 1
        
        # Distribution tracking
        bucket = self.get_risk_bucket(risk_score)
        self.risk_distribution[bucket] += 1
        
        self.decision_counts[decision] += 1
        
        for pattern in patterns:
            self.pattern_counts[pattern] += 1
        
        country = merchant.get("country", "Unknown")
        self.country_counts[country] += 1
        
        category = merchant.get("category", "unknown")
        self.category_counts[category] += 1

    def get_risk_bucket(self, score: int) -> str:
        """Get risk bucket label for score"""
        if score <= 20:
            return "0-20"
        elif score <= 40:
            return "21-40"
        elif score <= 60:
            return "41-60"
        elif score <= 80:
            return "61-80"
        else:
            return "81-100"

    async def publish_metrics(self) -> None:
        """Publish aggregated metrics"""
        avg_score = self.risk_score_sum / max(self.total_transactions, 1)
        avg_confidence = self.confidence_sum / max(self.total_transactions, 1)
        
        metrics = {
            "timestamp": datetime.utcnow().isoformat(),
            "totals": {
                "transactions": self.total_transactions,
                "fraud_detected": self.total_fraud_detected,
                "blocked": self.total_blocked,
                "amount_processed": round(self.total_amount, 2),
                "fraud_amount": round(self.fraud_amount, 2),
            },
            "rates": {
                "fraud_rate": round(self.total_fraud_detected / max(self.total_transactions, 1) * 100, 2),
                "block_rate": round(self.total_blocked / max(self.total_fraud_detected, 1) * 100, 2),
                "avg_risk_score": round(avg_score, 1),
                "avg_confidence": round(avg_confidence, 3),
            },
            "distributions": {
                "risk_scores": dict(self.risk_distribution),
                "decisions": dict(self.decision_counts),
                "patterns": dict(self.pattern_counts),
                "countries": dict(self.country_counts),
                "categories": dict(self.category_counts),
            },
        }
        
        await self.publish("fraud/metrics/aggregates", json.dumps(metrics))
        self.logger.debug(f"Published metrics: {self.total_transactions} txns, {self.total_fraud_detected} fraud")


agent = MetricsAggregatorAgent()

if __name__ == "__main__":
    agent.run()
