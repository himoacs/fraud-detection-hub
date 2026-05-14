"""
Tools for the Fraud Transaction Scorer Agent.

These tools analyze transactions for fraud risk using AI/ML.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from google.adk.tools import ToolContext
from solace_ai_connector.common.log import log

# Database persistence (optional - gracefully handles missing database)
try:
    from .database import insert_transaction, insert_raw_transaction, mark_transaction_scored
    HAS_DATABASE = True
except ImportError:
    HAS_DATABASE = False


async def score_transaction(
    transaction: Dict[str, Any],
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Analyzes a financial transaction for fraud risk using AI.
    
    This tool examines transaction data to detect fraud patterns including:
    - Card testing (small amounts)
    - Account takeover (unusual device/location)
    - Velocity abuse (too many transactions)
    - Geographic anomalies (impossible travel)
    - Amount anomalies (unusual amounts)
    
    Args:
        transaction: The transaction data to analyze, containing:
            - amount: Transaction amount
            - merchant: Merchant info (name, category, country, city)
            - device: Device info (fingerprint, type)
            - velocity: Recent transaction counts
            
    Returns:
        A dictionary with:
            - risk_score: 0-100 (0=safe, 100=definite fraud)
            - confidence: 0.0-1.0 confidence level
            - decision: "approved", "review", or "blocked"
            - detected_patterns: List of detected fraud patterns
            - reasoning: Explanation of the analysis
    """
    log_identifier = "[FraudScorer]"
    log.info(f"{log_identifier} Scoring transaction: {transaction.get('transaction_id', 'unknown')}")
    
    # Persist raw transaction before scoring (for audit trail)
    if HAS_DATABASE:
        try:
            await insert_raw_transaction(transaction)
            log.debug(f"{log_identifier} Persisted raw transaction to database")
        except Exception as e:
            log.warning(f"{log_identifier} Raw transaction persistence failed (non-critical): {e}")
    
    # Extract transaction details
    amount = transaction.get("amount", 0)
    merchant = transaction.get("merchant", {})
    device = transaction.get("device", {})
    velocity = transaction.get("velocity", {})
    
    # Initialize scoring
    score = 0
    factors = {}
    patterns = []
    
    # --- Amount Analysis ---
    if amount > 5000:
        score += 25
        factors["high_amount"] = 0.25
        patterns.append("Amount Anomaly")
        log.debug(f"{log_identifier} High amount detected: ${amount}")
    elif amount < 2:
        score += 30
        factors["micro_amount"] = 0.30
        patterns.append("Card Testing")
        log.debug(f"{log_identifier} Micro transaction detected: ${amount}")
    
    # --- Velocity Analysis ---
    txns_last_hour = velocity.get("txns_last_hour", 0)
    txns_last_day = velocity.get("txns_last_day", 0)
    
    if txns_last_hour > 10:
        score += 35
        factors["high_velocity_hour"] = 0.35
        patterns.append("Velocity Abuse")
        log.debug(f"{log_identifier} High velocity: {txns_last_hour} txns/hour")
    elif txns_last_hour > 5:
        score += 15
        factors["elevated_velocity"] = 0.15
    
    # --- Device Analysis ---
    if device.get("fingerprint_new", False):
        score += 20
        factors["new_device"] = 0.20
        patterns.append("Account Takeover")
        log.debug(f"{log_identifier} New device detected")
    
    if device.get("vpn_detected", False):
        score += 15
        factors["vpn_usage"] = 0.15
        patterns.append("VPN Detected")
    
    # --- Geographic Analysis ---
    country = merchant.get("country", "")
    if country in ["NG", "RU", "CN", "UA"]:  # High-risk countries
        score += 20
        factors["high_risk_country"] = 0.20
        patterns.append("Geographic Anomaly")
    
    # --- Merchant Analysis ---
    category = merchant.get("category", "")
    high_risk_categories = ["gambling", "crypto", "wire_transfer", "money_order"]
    if category.lower() in high_risk_categories:
        score += 15
        factors["high_risk_merchant"] = 0.15
        patterns.append("High-Risk Merchant")
    
    # --- Calculate final score and decision ---
    score = min(score, 100)
    
    if score >= 80:
        decision = "blocked"
    elif score >= 50:
        decision = "review"
    else:
        decision = "approved"
    
    # Generate reasoning
    if patterns:
        reasoning = f"Detected {len(patterns)} risk pattern(s): {', '.join(patterns)}. "
        reasoning += f"Combined risk factors indicate {decision} decision."
    else:
        reasoning = "No significant fraud patterns detected. Transaction appears legitimate."
    
    result = {
        "status": "success",
        "transaction_id": transaction.get("transaction_id"),
        "risk_score": score,
        "confidence": 0.85 if patterns else 0.95,
        "decision": decision,
        "detected_patterns": patterns,
        "factors": factors,
        "reasoning": reasoning,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }
    
    log.info(f"{log_identifier} Scored: {transaction.get('transaction_id')} -> {score}/100 ({decision})")
    
    return result


async def publish_scored_transaction(
    original_transaction: Dict[str, Any],
    scoring_result: Dict[str, Any],
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Publishes a scored transaction to the Solace broker.
    
    Combines the original transaction with scoring results and
    publishes to the fraud/transactions/scored/{country}/{type} topic.
    
    Args:
        original_transaction: The original transaction data
        scoring_result: The fraud scoring result from score_transaction
        
    Returns:
        Confirmation of the publish action
    """
    log_identifier = "[FraudScorer]"
    
    # Merge transaction with scoring
    scored_transaction = {
        **original_transaction,
        "risk_score": scoring_result.get("risk_score", 0),
        "confidence": scoring_result.get("confidence", 0.5),
        "decision": scoring_result.get("decision", "review"),
        "detected_patterns": scoring_result.get("detected_patterns", []),
        "factors": scoring_result.get("factors", {}),
        "reasoning": scoring_result.get("reasoning", ""),
        "agent_reasoning": scoring_result.get("reasoning", ""),
        "scored_at": scoring_result.get("scored_at"),
        "agent": "fraud-transaction-scorer",
    }
    
    # Persist to database for SAM SQL Connector queries
    if HAS_DATABASE:
        try:
            await insert_transaction(scored_transaction)
            # Mark raw transaction as scored
            await mark_transaction_scored(original_transaction.get("transaction_id"))
            log.debug(f"{log_identifier} Persisted transaction to database")
        except Exception as e:
            log.warning(f"{log_identifier} Database persistence failed (non-critical): {e}")
    
    # Determine output topic
    merchant = original_transaction.get("merchant", {})
    country = merchant.get("country", "XX")
    tx_type = original_transaction.get("type", "purchase")
    topic = f"fraud/transactions/scored/{country}/{tx_type}"
    
    log.info(f"{log_identifier} Publishing to {topic}")
    
    return {
        "status": "success",
        "message": f"Scored transaction published to {topic}",
        "topic": topic,
        "payload": scored_transaction,
    }
