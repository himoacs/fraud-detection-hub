"""
Transaction Scorer Agent for SAM Enterprise

This agent subscribes to raw transactions, analyzes them using AI,
and publishes scored transactions with risk assessments.
"""

import json
import os
from datetime import datetime
from typing import Any

from solace_agent_mesh import Agent, AgentConfig, Message
from litellm import completion

# Agent configuration
config = AgentConfig(
    name="transaction-scorer",
    description="AI-powered transaction risk scoring agent",
    subscriptions=["fraud/transactions/raw/>"],
    publications=["fraud/transactions/scored/>"],
)

# Risk scoring prompt template
SCORING_PROMPT = """You are a fraud detection AI analyzing a financial transaction.
Analyze the following transaction and provide a risk assessment.

Transaction Data:
{transaction_json}

Analyze for these fraud patterns:
1. Card Testing - Small amounts testing card validity
2. Account Takeover - Unusual device, location, or behavior
3. Velocity Abuse - Too many transactions in short time
4. Geographic Anomaly - Impossible travel or unusual locations
5. Amount Anomaly - Unusually large amounts for this customer

Respond in JSON format:
{{
  "risk_score": <0-100>,
  "confidence": <0.0-1.0>,
  "decision": "<approved|blocked|review>",
  "detected_patterns": ["pattern1", "pattern2"],
  "factors": {{"factor_name": weight}},
  "reasoning": "Brief explanation"
}}

Only respond with valid JSON, no other text."""

class TransactionScorerAgent(Agent):
    """Agent that scores transactions using AI/ML"""

    def __init__(self):
        super().__init__(config)
        self.model = os.getenv("LITELLM_MODEL", "gpt-4o-mini")
        self.total_scored = 0
        self.total_fraud = 0

    async def process_message(self, message: Message) -> None:
        """Process incoming transaction and publish scored result"""
        try:
            # Parse transaction from message
            transaction = json.loads(message.payload)
            
            # Score the transaction using AI
            scored = await self.score_transaction(transaction)
            
            # Determine output topic based on country/type
            country = transaction.get("merchant", {}).get("country", "XX")
            tx_type = transaction.get("type", "unknown")
            output_topic = f"fraud/transactions/scored/{country}/{tx_type}"
            
            # Publish scored transaction
            await self.publish(output_topic, json.dumps(scored))
            
            # Update metrics
            self.total_scored += 1
            if scored.get("risk_score", 0) >= 70:
                self.total_fraud += 1
                
        except Exception as e:
            self.logger.error(f"Error processing transaction: {e}")

    async def score_transaction(self, transaction: dict) -> dict:
        """Use LiteLLM to score the transaction"""
        try:
            # Prepare the prompt
            prompt = SCORING_PROMPT.format(
                transaction_json=json.dumps(transaction, indent=2)
            )
            
            # Call LiteLLM
            response = completion(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a fraud detection AI. Respond only with valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=500,
            )
            
            # Parse AI response
            ai_result = json.loads(response.choices[0].message.content)
            
            # Merge AI scoring with original transaction
            scored_transaction = {
                **transaction,
                "risk_score": ai_result.get("risk_score", 0),
                "confidence": ai_result.get("confidence", 0.5),
                "decision": ai_result.get("decision", "review"),
                "detected_patterns": ai_result.get("detected_patterns", []),
                "factors": ai_result.get("factors", {}),
                "agent_reasoning": ai_result.get("reasoning", ""),
                "scored_at": datetime.utcnow().isoformat(),
                "processing_time_ms": response.response_ms if hasattr(response, 'response_ms') else 100,
            }
            
            return scored_transaction
            
        except Exception as e:
            self.logger.error(f"AI scoring failed: {e}")
            # Fallback to rule-based scoring
            return self.fallback_scoring(transaction)

    def fallback_scoring(self, transaction: dict) -> dict:
        """Rule-based fallback when AI is unavailable"""
        score = 0
        factors = {}
        signals = []
        
        # Amount-based rules
        amount = transaction.get("amount", 0)
        if amount > 5000:
            score += 30
            factors["high_amount"] = 0.3
            signals.append("High transaction amount")
        elif amount < 2:
            score += 25
            factors["micro_amount"] = 0.25
            signals.append("Micro transaction (potential card testing)")
        
        # Velocity rules
        velocity = transaction.get("velocity", {})
        txns_last_hour = velocity.get("txns_last_hour", 0)
        if txns_last_hour > 10:
            score += 35
            factors["high_velocity"] = 0.35
            signals.append("High transaction velocity")
        
        # Customer risk tier
        customer = transaction.get("customer", {})
        if customer.get("risk_tier") == "high":
            score += 20
            factors["high_risk_customer"] = 0.2
            signals.append("High-risk customer tier")
        
        # New account
        if customer.get("account_age_days", 365) < 30:
            score += 15
            factors["new_account"] = 0.15
            signals.append("New account")
        
        decision = "blocked" if score >= 80 else "review" if score >= 50 else "approved"
        
        return {
            **transaction,
            "risk_score": min(score, 100),
            "confidence": 0.6,
            "decision": decision,
            "detected_patterns": signals,
            "factors": factors,
            "agent_reasoning": f"Rule-based scoring: {', '.join(signals) if signals else 'Normal transaction'}",
            "scored_at": datetime.utcnow().isoformat(),
            "processing_time_ms": 5,
        }


# Agent entry point for SAM
agent = TransactionScorerAgent()

if __name__ == "__main__":
    agent.run()
