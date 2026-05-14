"""
Tools for the Fraud Metrics Aggregator Agent.

These tools aggregate transaction metrics in real-time.
"""

import json
from datetime import datetime, timezone
from collections import defaultdict
from typing import Any, Dict, List, Optional

from google.adk.tools import ToolContext
from solace_ai_connector.common.log import log

# Module-level metrics storage (persists across tool calls)
_metrics_state = {
    "total_transactions": 0,
    "fraud_detected": 0,
    "total_blocked": 0,
    "total_approved": 0,
    "total_review": 0,
    "total_amount": 0.0,
    "fraud_amount": 0.0,
    "risk_score_sum": 0,
    "confidence_sum": 0.0,
    "pattern_counts": defaultdict(int),
    "country_counts": defaultdict(int),
    "category_counts": defaultdict(int),
    "risk_distribution": defaultdict(int),
    "start_time": None,
    "last_update": None,
}


async def aggregate_transaction(
    scored_transaction: Dict[str, Any],
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Aggregates metrics from a scored transaction.
    
    Updates running totals and distributions for real-time metrics.
    
    Args:
        scored_transaction: The scored transaction to aggregate
        
    Returns:
        Current aggregated metrics summary
    """
    log_identifier = "[MetricsAggregator]"
    global _metrics_state
    
    # Initialize start time on first call
    if _metrics_state["start_time"] is None:
        _metrics_state["start_time"] = datetime.now(timezone.utc)
    
    _metrics_state["last_update"] = datetime.now(timezone.utc)
    
    # Update counts
    _metrics_state["total_transactions"] += 1
    
    # Amount tracking
    amount = scored_transaction.get("amount", 0)
    _metrics_state["total_amount"] += amount
    
    # Risk metrics
    risk_score = scored_transaction.get("risk_score", 0)
    confidence = scored_transaction.get("confidence", 0.5)
    
    _metrics_state["risk_score_sum"] += risk_score
    _metrics_state["confidence_sum"] += confidence
    
    # Risk bucket (0-9, 10-19, etc.)
    bucket = (risk_score // 10) * 10
    _metrics_state["risk_distribution"][bucket] += 1
    
    # Fraud detection
    if risk_score >= 70:
        _metrics_state["fraud_detected"] += 1
        _metrics_state["fraud_amount"] += amount
    
    # Decision tracking
    decision = scored_transaction.get("decision", "unknown")
    if decision == "blocked":
        _metrics_state["total_blocked"] += 1
    elif decision == "approved":
        _metrics_state["total_approved"] += 1
    elif decision == "review":
        _metrics_state["total_review"] += 1
    
    # Pattern tracking
    patterns = scored_transaction.get("detected_patterns", [])
    for pattern in patterns:
        _metrics_state["pattern_counts"][pattern] += 1
    
    # Geographic tracking
    merchant = scored_transaction.get("merchant", {})
    country = merchant.get("country", "XX")
    category = merchant.get("category", "Unknown")
    
    _metrics_state["country_counts"][country] += 1
    _metrics_state["category_counts"][category] += 1
    
    log.debug(f"{log_identifier} Aggregated transaction {scored_transaction.get('transaction_id')}")
    
    return {
        "status": "success",
        "total_transactions": _metrics_state["total_transactions"],
        "fraud_detected": _metrics_state["fraud_detected"],
    }


async def get_metrics_summary(
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Returns the current aggregated metrics summary.
    
    Calculates rates, averages, and top patterns from accumulated data.
    
    Returns:
        Comprehensive metrics summary for the dashboard
    """
    log_identifier = "[MetricsAggregator]"
    global _metrics_state
    
    now = datetime.now(timezone.utc)
    
    # Calculate uptime
    start = _metrics_state.get("start_time") or now
    uptime = (now - start).total_seconds()
    
    total = _metrics_state["total_transactions"]
    
    # Calculate rates
    tps = total / max(uptime, 1)
    fraud_rate = (_metrics_state["fraud_detected"] / max(total, 1)) * 100
    
    # Calculate averages
    avg_risk = _metrics_state["risk_score_sum"] / max(total, 1)
    avg_confidence = _metrics_state["confidence_sum"] / max(total, 1)
    avg_amount = _metrics_state["total_amount"] / max(total, 1)
    
    # Top patterns
    top_patterns = sorted(
        _metrics_state["pattern_counts"].items(),
        key=lambda x: x[1],
        reverse=True
    )[:5]
    
    # Top countries
    top_countries = sorted(
        _metrics_state["country_counts"].items(),
        key=lambda x: x[1],
        reverse=True
    )[:5]
    
    # Risk distribution
    risk_dist = [
        {"range": f"{k}-{k+9}", "count": v}
        for k, v in sorted(_metrics_state["risk_distribution"].items())
    ]
    
    summary = {
        "timestamp": now.isoformat(),
        "uptime_seconds": round(uptime, 1),
        
        # Transaction counts
        "total_transactions": total,
        "transactions_per_second": round(tps, 2),
        
        # Fraud metrics
        "fraud_detected": _metrics_state["fraud_detected"],
        "fraud_rate_percent": round(fraud_rate, 2),
        "fraud_amount": round(_metrics_state["fraud_amount"], 2),
        
        # Decisions
        "decisions": {
            "approved": _metrics_state["total_approved"],
            "blocked": _metrics_state["total_blocked"],
            "review": _metrics_state["total_review"],
        },
        
        # Amounts
        "total_amount": round(_metrics_state["total_amount"], 2),
        "average_amount": round(avg_amount, 2),
        
        # Risk analysis
        "average_risk_score": round(avg_risk, 1),
        "average_confidence": round(avg_confidence, 3),
        "risk_distribution": risk_dist,
        
        # Top patterns
        "top_patterns": [{"pattern": p, "count": c} for p, c in top_patterns],
        "top_countries": [{"country": c, "count": n} for c, n in top_countries],
        
        "agent": "fraud-metrics-aggregator",
    }
    
    log.info(f"{log_identifier} Metrics summary: {total} txns, {fraud_rate:.1f}% fraud rate")
    
    return {
        "status": "success",
        "metrics": summary,
        "topic": "fraud/metrics/aggregates",
        "payload": summary,
    }


async def reset_metrics(
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Resets all metrics to zero.
    
    Use this to start fresh metric collection.
    
    Returns:
        Confirmation of reset
    """
    log_identifier = "[MetricsAggregator]"
    global _metrics_state
    
    _metrics_state = {
        "total_transactions": 0,
        "fraud_detected": 0,
        "total_blocked": 0,
        "total_approved": 0,
        "total_review": 0,
        "total_amount": 0.0,
        "fraud_amount": 0.0,
        "risk_score_sum": 0,
        "confidence_sum": 0.0,
        "pattern_counts": defaultdict(int),
        "country_counts": defaultdict(int),
        "category_counts": defaultdict(int),
        "risk_distribution": defaultdict(int),
        "start_time": datetime.now(timezone.utc),
        "last_update": None,
    }
    
    log.info(f"{log_identifier} Metrics reset")
    
    return {
        "status": "success",
        "message": "All metrics have been reset",
    }
