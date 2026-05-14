"""
Database module for persisting fraud detection data to PostgreSQL.

This module provides write operations for storing transactions and alerts.
The SAM SQL Connector handles all read queries via natural language.
"""

import os
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from contextlib import asynccontextmanager

try:
    import asyncpg
    HAS_ASYNCPG = True
except ImportError:
    HAS_ASYNCPG = False

from solace_ai_connector.common.log import log

# Database connection pool
_pool: Optional[asyncpg.Pool] = None

# Connection settings from environment
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@agent-mesh-postgresql:5432/fraud_detection"
)


async def get_pool() -> asyncpg.Pool:
    """Get or create the database connection pool."""
    global _pool
    
    if not HAS_ASYNCPG:
        raise ImportError("asyncpg is required for database operations. Install with: pip install asyncpg")
    
    if _pool is None:
        log.info("[Database] Creating connection pool...")
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        log.info("[Database] Connection pool created")
    
    return _pool


async def close_pool():
    """Close the database connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        log.info("[Database] Connection pool closed")


@asynccontextmanager
async def get_connection():
    """Get a database connection from the pool."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def insert_transaction(transaction: Dict[str, Any]) -> bool:
    """
    Insert a scored transaction into the database.
    
    Args:
        transaction: The scored transaction data
        
    Returns:
        True if successful, False otherwise
    """
    try:
        async with get_connection() as conn:
            merchant = transaction.get("merchant", {})
            device = transaction.get("device", {})
            velocity = transaction.get("velocity", {})
            
            await conn.execute("""
                INSERT INTO transactions (
                    transaction_id, timestamp, amount, currency,
                    risk_score, confidence, decision,
                    detected_patterns, agent_reasoning,
                    merchant_name, merchant_category, merchant_country, merchant_city,
                    device_fingerprint, device_type, vpn_detected, new_device,
                    velocity_txns_last_hour, velocity_txns_last_day,
                    is_fraud, fraud_pattern
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7,
                    $8, $9,
                    $10, $11, $12, $13,
                    $14, $15, $16, $17,
                    $18, $19,
                    $20, $21
                )
                ON CONFLICT (transaction_id) DO UPDATE SET
                    risk_score = EXCLUDED.risk_score,
                    decision = EXCLUDED.decision,
                    detected_patterns = EXCLUDED.detected_patterns,
                    agent_reasoning = EXCLUDED.agent_reasoning
            """,
                transaction.get("transaction_id"),
                datetime.fromisoformat(transaction.get("timestamp", datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00")),
                float(transaction.get("amount", 0)),
                transaction.get("currency", "USD"),
                int(transaction.get("risk_score", 0)),
                float(transaction.get("confidence", 0.5)),
                transaction.get("decision", "review"),
                json.dumps(transaction.get("detected_patterns", [])),
                transaction.get("agent_reasoning", transaction.get("reasoning", "")),
                merchant.get("name", "Unknown"),
                merchant.get("category", "Unknown"),
                merchant.get("country", "XX"),
                merchant.get("city", "Unknown"),
                device.get("fingerprint", None),
                device.get("type", None),
                device.get("vpn_detected", False),
                device.get("fingerprint_new", False),
                velocity.get("txns_last_hour", 0),
                velocity.get("txns_last_day", 0),
                transaction.get("_fraud_label", False),
                transaction.get("_fraud_pattern", None),
            )
            
            log.debug(f"[Database] Inserted transaction {transaction.get('transaction_id')}")
            return True
            
    except Exception as e:
        log.error(f"[Database] Failed to insert transaction: {e}")
        return False


async def insert_raw_transaction(transaction: Dict[str, Any]) -> bool:
    """
    Insert a raw (unscored) transaction into the database.
    
    Args:
        transaction: The raw transaction data before scoring
        
    Returns:
        True if successful, False otherwise
    """
    try:
        async with get_connection() as conn:
            merchant = transaction.get("merchant", {})
            device = transaction.get("device", {})
            card = transaction.get("card", {})
            
            await conn.execute("""
                INSERT INTO raw_transactions (
                    transaction_id, timestamp, amount, currency,
                    merchant_name, merchant_category, merchant_country, merchant_city,
                    card_type, card_last_four,
                    device_fingerprint, device_type, ip_address,
                    raw_payload
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10,
                    $11, $12, $13,
                    $14
                )
                ON CONFLICT (transaction_id) DO NOTHING
            """,
                transaction.get("transaction_id"),
                datetime.fromisoformat(transaction.get("timestamp", datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00")),
                float(transaction.get("amount", 0)),
                transaction.get("currency", "USD"),
                merchant.get("name", "Unknown"),
                merchant.get("category", "Unknown"),
                merchant.get("country", "XX"),
                merchant.get("city", "Unknown"),
                card.get("type", None),
                card.get("last_four", None),
                device.get("fingerprint", None),
                device.get("type", None),
                device.get("ip", None),
                json.dumps(transaction),
            )
            
            log.debug(f"[Database] Inserted raw transaction {transaction.get('transaction_id')}")
            return True
            
    except Exception as e:
        log.error(f"[Database] Failed to insert raw transaction: {e}")
        return False


async def mark_transaction_scored(transaction_id: str) -> bool:
    """
    Mark a raw transaction as scored.
    
    Args:
        transaction_id: The transaction ID to mark as scored
        
    Returns:
        True if successful, False otherwise
    """
    try:
        async with get_connection() as conn:
            await conn.execute("""
                UPDATE raw_transactions 
                SET scored = TRUE, scored_at = NOW()
                WHERE transaction_id = $1
            """, transaction_id)
            return True
    except Exception as e:
        log.error(f"[Database] Failed to mark transaction scored: {e}")
        return False


async def insert_alert(alert: Dict[str, Any]) -> bool:
    """
    Insert a fraud alert into the database.
    
    Args:
        alert: The alert data
        
    Returns:
        True if successful, False otherwise
    """
    try:
        async with get_connection() as conn:
            await conn.execute("""
                INSERT INTO alerts (
                    alert_id, timestamp, severity, headline,
                    transaction_id, risk_score, primary_pattern, all_patterns,
                    amount, currency, merchant_name, merchant_country
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10, $11, $12
                )
                ON CONFLICT (alert_id) DO NOTHING
            """,
                alert.get("id"),
                datetime.fromisoformat(alert.get("timestamp", datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00")),
                alert.get("severity", "medium"),
                alert.get("headline", ""),
                alert.get("transaction_id"),
                int(alert.get("score", alert.get("risk_score", 0))),
                alert.get("pattern", alert.get("primary_pattern", "")),
                json.dumps(alert.get("patterns", [])),
                float(alert.get("amount", 0)),
                alert.get("currency", "USD"),
                alert.get("merchant", alert.get("merchant_name", "Unknown")),
                alert.get("country", alert.get("merchant_country", "XX")),
            )
            
            log.debug(f"[Database] Inserted alert {alert.get('id')}")
            return True
            
    except Exception as e:
        log.error(f"[Database] Failed to insert alert: {e}")
        return False


# Optional: Synchronous wrappers for non-async contexts
def insert_transaction_sync(transaction: Dict[str, Any]) -> bool:
    """Synchronous wrapper for insert_transaction."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If we're in an async context, create a task
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(
                    asyncio.run,
                    insert_transaction(transaction)
                )
                return future.result(timeout=5)
        else:
            return loop.run_until_complete(insert_transaction(transaction))
    except Exception as e:
        log.error(f"[Database] Sync insert_transaction failed: {e}")
        return False


def insert_alert_sync(alert: Dict[str, Any]) -> bool:
    """Synchronous wrapper for insert_alert."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(
                    asyncio.run,
                    insert_alert(alert)
                )
                return future.result(timeout=5)
        else:
            return loop.run_until_complete(insert_alert(alert))
    except Exception as e:
        log.error(f"[Database] Sync insert_alert failed: {e}")
        return False
