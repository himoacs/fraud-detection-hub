"""
Tools for the Fraud Alert Generator Agent.

These tools generate alerts for high-risk transactions.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from google.adk.tools import ToolContext
from solace_ai_connector.common.log import log

# Database persistence (optional - gracefully handles missing database)
try:
    from .database import insert_alert
    HAS_DATABASE = True
except ImportError:
    HAS_DATABASE = False


async def evaluate_alert_criteria(
    scored_transaction: Dict[str, Any],
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Evaluates whether a scored transaction requires an alert.
    
    Args:
        scored_transaction: Transaction with risk scoring results
        
    Returns:
        Dictionary indicating if alert is needed and severity
    """
    log_identifier = "[AlertGenerator]"
    
    risk_score = scored_transaction.get("risk_score", 0)
    threshold = 70
    
    if tool_config:
        threshold = tool_config.get("alert_threshold", 70)
    
    needs_alert = risk_score >= threshold
    
    # Determine severity
    if risk_score >= 90:
        severity = "critical"
    elif risk_score >= 80:
        severity = "high"
    elif risk_score >= 70:
        severity = "medium"
    else:
        severity = "low"
    
    log.info(f"{log_identifier} Evaluated: score={risk_score}, needs_alert={needs_alert}")
    
    return {
        "status": "success",
        "needs_alert": needs_alert,
        "risk_score": risk_score,
        "severity": severity,
        "threshold": threshold,
    }


async def generate_alert(
    scored_transaction: Dict[str, Any],
    severity: str,
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Generates a fraud alert for a high-risk transaction.
    
    Creates a detailed alert with actionable information for fraud analysts.
    
    Args:
        scored_transaction: The transaction with risk scoring
        severity: Alert severity level (critical, high, medium, low)
        
    Returns:
        The generated alert object ready for publishing
    """
    log_identifier = "[AlertGenerator]"
    
    transaction_id = scored_transaction.get("transaction_id", "unknown")
    risk_score = scored_transaction.get("risk_score", 0)
    patterns = scored_transaction.get("detected_patterns", [])
    merchant = scored_transaction.get("merchant", {})
    amount = scored_transaction.get("amount", 0)
    
    # Generate alert headline
    primary_pattern = patterns[0] if patterns else "High Risk"
    merchant_name = merchant.get("name", "Unknown Merchant")
    
    headlines = {
        "critical": f"🚨 CRITICAL: {primary_pattern} - ${amount:.2f} at {merchant_name}",
        "high": f"⚠️ HIGH RISK: {primary_pattern} detected - ${amount:.2f}",
        "medium": f"⚡ ALERT: Suspicious {primary_pattern} pattern - ${amount:.2f}",
        "low": f"ℹ️ Notice: Minor risk indicators - ${amount:.2f}",
    }
    
    headline = headlines.get(severity, headlines["medium"])[:80]
    
    # Build alert object
    alert = {
        "id": f"ALT-{uuid4().hex[:12].upper()}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "severity": severity,
        "headline": headline,
        "transaction_id": transaction_id,
        "score": risk_score,
        "pattern": primary_pattern,
        "patterns": patterns,
        "amount": amount,
        "currency": scored_transaction.get("currency", "USD"),
        "merchant": merchant_name,
        "merchant_category": merchant.get("category", "Unknown"),
        "country": merchant.get("country", "XX"),
        "city": merchant.get("city", "Unknown"),
        "reasoning": scored_transaction.get("reasoning", ""),
        "decision": scored_transaction.get("decision", "review"),
        "confidence": scored_transaction.get("confidence", 0.5),
        "agent": "fraud-alert-generator",
    }
    
    log.info(f"{log_identifier} Generated alert: {alert['id']} - {severity}")
    
    # Persist to database for SAM SQL Connector queries
    if HAS_DATABASE:
        try:
            await insert_alert(alert)
            log.debug(f"{log_identifier} Persisted alert to database")
        except Exception as e:
            log.warning(f"{log_identifier} Database persistence failed (non-critical): {e}")
    
    return {
        "status": "success",
        "alert": alert,
        "topic": f"fraud/alerts/{severity}",
    }


async def publish_alert(
    alert: Dict[str, Any],
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Publishes an alert to the Solace broker.
    
    Args:
        alert: The alert object to publish
        
    Returns:
        Confirmation of the publish action
    """
    log_identifier = "[AlertGenerator]"
    
    severity = alert.get("severity", "medium")
    topic = f"fraud/alerts/{severity}"
    
    log.info(f"{log_identifier} Publishing alert {alert.get('id')} to {topic}")
    
    return {
        "status": "success",
        "message": f"Alert published to {topic}",
        "topic": topic,
        "payload": alert,
    }
