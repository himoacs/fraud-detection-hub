"""
Database handler for inserting raw Solace events into PostgreSQL.
"""
import os
import json
import sys
import psycopg2
from psycopg2.extras import Json


def get_connection():
    return psycopg2.connect(
        host=os.getenv('POSTGRES_HOST', 'host.docker.internal'),
        port=int(os.getenv('POSTGRES_PORT', 5432)),
        user=os.getenv('POSTGRES_USER', 'postgres'),
        password=os.getenv('POSTGRES_PASSWORD', 'password'),
        database=os.getenv('POSTGRES_DATABASE', 'fraud_detection')
    )


def insert_raw_event(data, user_data, message_info):
    """
    Insert raw Solace events into raw_events table.
    Aggregate component calls this with batched data.
    
    Args:
        data: List of message payloads (aggregate batches them)
        user_data: User data dict  
        message_info: Message metadata
    
    Returns:
        dict with status
    """
    print(f"[DB_HANDLER] insert_raw_event called", file=sys.stderr)
    print(f"[DB_HANDLER] data type: {type(data)}", file=sys.stderr)
    print(f"[DB_HANDLER] message_info: {message_info}", file=sys.stderr)
    
    try:
        conn = get_connection()
        cur = conn.cursor()
        inserted = 0
        
        # Handle both single item and list of items
        items = data if isinstance(data, list) else [data]
        
        for item in items:
            # Extract topic from item or message_info
            if isinstance(item, dict):
                topic = item.get('topic', 'unknown')
                payload = item.get('payload', item)
            else:
                topic = 'unknown'
                payload = item
            
            # Use psycopg2.extras.Json for proper JSONB handling
            cur.execute(
                "INSERT INTO raw_events (topic, payload) VALUES (%s, %s)",
                (topic, Json(payload))
            )
            inserted += 1
        
        conn.commit()
        cur.close()
        conn.close()
        
        print(f"[DB_HANDLER] Inserted {inserted} records", file=sys.stderr)
        return {"status": "inserted", "count": inserted}
    except Exception as e:
        print(f"[DB_HANDLER] ERROR: {e}", file=sys.stderr)
        return {"status": "error", "error": str(e)}


def insert_scored_event(data, user_data, message_info):
    """Insert a scored transaction event."""
    topic = message_info.get('topic', 'unknown') if message_info else 'unknown'
    
    try:
        # Handle markdown-wrapped JSON
        payload = data
        if isinstance(data, str):
            # Strip markdown code block
            cleaned = data.strip()
            if cleaned.startswith('```json'):
                cleaned = cleaned[7:]
            if cleaned.startswith('```'):
                cleaned = cleaned[3:]
            if cleaned.endswith('```'):
                cleaned = cleaned[:-3]
            payload = json.loads(cleaned.strip())
        
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO raw_events (topic, payload) VALUES (%s, %s)",
            (topic, Json(payload))
        )
        conn.commit()
        cur.close()
        conn.close()
        
        return {"status": "inserted", "topic": topic}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def insert_alert_event(data, user_data, message_info):
    """Insert an alert event."""
    return insert_scored_event(data, user_data, message_info)
