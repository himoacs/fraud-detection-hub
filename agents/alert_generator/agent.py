"""
Alert Generator Agent for SAM Enterprise

This agent monitors scored transactions and generates
real-time alerts for high-risk transactions.
"""

import json
import os
from datetime import datetime
from typing import Any
from uuid import uuid4

from solace_agent_mesh import Agent, AgentConfig, Message
from litellm import completion

config = AgentConfig(
    name="alert-generator",
    description="Generates alerts for high-risk transactions",
    subscriptions=["fraud/transactions/scored/>"],
    publications=["fraud/alerts/>"],
)

ALERT_PROMPT = """You are a fraud alert system. Generate a concise, actionable alert headline
for a fraud analyst reviewing this high-risk transaction.

Transaction:
- Amount: ${amount}
- Merchant: {merchant_name} ({merchant_category})
- Location: {city}, {country}
- Risk Score: {risk_score}/100
- Detected Patterns: {patterns}
- AI Reasoning: {reasoning}

Generate a single-line alert headline (max 80 chars) that:
1. Identifies the most critical risk factor
2. Is actionable for a fraud analyst
3. Includes key context (amount, location, or pattern)

Respond with only the headline text, no quotes or additional formatting."""


class AlertGeneratorAgent(Agent):
    """Agent that generates alerts from high-risk transactions"""

    def __init__(self):
        super().__init__(config)
        self.model = os.getenv("LITELLM_MODEL", "gpt-4o-mini")
        self.alert_threshold = int(os.getenv("ALERT_THRESHOLD", "70"))
        self.alerts_generated = 0

    async def process_message(self, message: Message) -> None:
        """Process scored transaction and generate alert if needed"""
        try:
            transaction = json.loads(message.payload)
            risk_score = transaction.get("risk_score", 0)
            
            # Only generate alerts for high-risk transactions
            if risk_score < self.alert_threshold:
                return
            
            alert = await self.generate_alert(transaction)
            
            # Publish to severity-specific topic
            severity = alert["severity"]
            await self.publish(f"fraud/alerts/{severity}", json.dumps(alert))
            
            self.alerts_generated += 1
            self.logger.info(f"Alert generated: {alert['headline']}")
            
        except Exception as e:
            self.logger.error(f"Error generating alert: {e}")

    async def generate_alert(self, transaction: dict) -> dict:
        """Generate an alert from a high-risk transaction"""
        risk_score = transaction.get("risk_score", 0)
        
        # Determine severity
        if risk_score >= 90:
            severity = "critical"
        elif risk_score >= 80:
            severity = "high"
        elif risk_score >= 70:
            severity = "medium"
        else:
            severity = "low"
        
        # Generate AI headline
        headline = await self.generate_headline(transaction)
        
        return {
            "id": f"ALT-{uuid4().hex[:12].upper()}",
            "timestamp": datetime.utcnow().isoformat(),
            "severity": severity,
            "headline": headline,
            "transaction_id": transaction.get("transaction_id"),
            "score": risk_score,
            "pattern": transaction.get("detected_patterns", [None])[0],
            "amount": transaction.get("amount"),
            "merchant": transaction.get("merchant", {}).get("name"),
            "customer_id": transaction.get("customer", {}).get("id"),
            "decision": transaction.get("decision"),
            "requires_action": severity in ["critical", "high"],
        }

    async def generate_headline(self, transaction: dict) -> str:
        """Use AI to generate alert headline"""
        try:
            merchant = transaction.get("merchant", {})
            patterns = transaction.get("detected_patterns", [])
            
            prompt = ALERT_PROMPT.format(
                amount=transaction.get("amount", 0),
                merchant_name=merchant.get("name", "Unknown"),
                merchant_category=merchant.get("category", "unknown"),
                city=merchant.get("city", "Unknown"),
                country=merchant.get("country", "XX"),
                risk_score=transaction.get("risk_score", 0),
                patterns=", ".join(patterns) if patterns else "Multiple indicators",
                reasoning=transaction.get("agent_reasoning", "High risk detected"),
            )
            
            response = completion(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=100,
            )
            
            headline = response.choices[0].message.content.strip()
            # Truncate if too long
            return headline[:80] if len(headline) > 80 else headline
            
        except Exception as e:
            self.logger.error(f"AI headline generation failed: {e}")
            # Fallback headline
            patterns = transaction.get("detected_patterns", ["Suspicious activity"])
            return f"{patterns[0].upper()} - ${transaction.get('amount', 0):.2f} at {transaction.get('merchant', {}).get('name', 'Unknown')}"


agent = AlertGeneratorAgent()

if __name__ == "__main__":
    agent.run()
