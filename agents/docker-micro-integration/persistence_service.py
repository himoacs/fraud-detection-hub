#!/usr/bin/env python3
"""
Solace-to-PostgreSQL persistence service.
Subscribes to Solace queues and writes events to separate PostgreSQL tables.
"""
import os
import json
import re
import time
import threading
from datetime import datetime
import psycopg2

from solace.messaging.messaging_service import MessagingService
from solace.messaging.receiver.persistent_message_receiver import PersistentMessageReceiver
from solace.messaging.resources.queue import Queue


def get_db_connection():
    """Get a PostgreSQL connection."""
    return psycopg2.connect(
        host=os.getenv('POSTGRES_HOST', 'host.docker.internal'),
        port=int(os.getenv('POSTGRES_PORT', 5432)),
        user=os.getenv('POSTGRES_USER', 'postgres'),
        password=os.getenv('POSTGRES_PASSWORD', 'password'),
        database=os.getenv('POSTGRES_DATABASE', 'fraud_detection')
    )


def parse_markdown_json(text: str) -> dict:
    """Parse JSON that might be wrapped in markdown code blocks."""
    if isinstance(text, dict):
        return text
    
    cleaned = text.strip()
    if cleaned.startswith('```json'):
        cleaned = cleaned[7:]
    elif cleaned.startswith('```'):
        cleaned = cleaned[3:]
    if cleaned.endswith('```'):
        cleaned = cleaned[:-3]
    
    try:
        return json.loads(cleaned.strip())
    except:
        return {"raw_text": text}


def insert_raw_transaction(topic: str, payload: dict):
    """Insert into raw_transactions table."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Handle nested raw_text containing the actual JSON
        actual_payload = payload
        if 'raw_text' in payload and isinstance(payload['raw_text'], str):
            try:
                # Find JSON in the raw_text (may have binary prefix)
                raw_text = payload['raw_text']
                json_start = raw_text.find('{')
                if json_start >= 0:
                    actual_payload = json.loads(raw_text[json_start:])
            except:
                pass
        
        # Extract key fields for easier querying
        transaction_id = actual_payload.get('transaction_id')
        amount = actual_payload.get('amount')
        currency = actual_payload.get('currency')
        merchant = actual_payload.get('merchant', {})
        merchant_name = merchant.get('name') if isinstance(merchant, dict) else None
        customer = actual_payload.get('customer', {})
        customer_id = customer.get('id') if isinstance(customer, dict) else None
        country = merchant.get('country') if isinstance(merchant, dict) else None
        
        payload_json = json.dumps(actual_payload).replace('\\u0000', '')
        
        cur.execute("""
            INSERT INTO raw_transactions 
            (transaction_id, amount, currency, merchant_name, customer_id, country, topic, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """, (transaction_id, amount, currency, merchant_name, customer_id, country, topic, payload_json))
        
        conn.commit()
        cur.close()
        conn.close()
        print(f"[{datetime.now().isoformat()}] raw_transactions: {transaction_id} ${amount}")
        return True
    except Exception as e:
        print(f"[{datetime.now().isoformat()}] ERROR raw_transactions: {e}")
        return False


def insert_scored_transaction(topic: str, payload):
    """Insert into scored_transactions table."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Ensure payload is a dict
        if isinstance(payload, str):
            payload = {"raw_text": payload}
        
        # Handle nested raw_text containing markdown-wrapped JSON
        actual_payload = payload
        if 'raw_text' in payload and isinstance(payload['raw_text'], str):
            actual_payload = parse_markdown_json(payload['raw_text'])
        
        # Extract key fields
        transaction_id = actual_payload.get('transaction_id')
        risk_score = actual_payload.get('risk_score')
        risk_level = actual_payload.get('risk_level')
        decision = actual_payload.get('decision')
        detected_patterns = actual_payload.get('detected_patterns', [])
        
        payload_json = json.dumps(actual_payload).replace('\\u0000', '')
        
        cur.execute("""
            INSERT INTO scored_transactions 
            (transaction_id, risk_score, risk_level, decision, detected_patterns, topic, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
        """, (transaction_id, risk_score, risk_level, decision, detected_patterns, topic, payload_json))
        
        conn.commit()
        cur.close()
        conn.close()
        print(f"[{datetime.now().isoformat()}] scored_transactions: {transaction_id} score={risk_score} {decision}")
        return True
    except Exception as e:
        print(f"[{datetime.now().isoformat()}] ERROR scored_transactions: {e}")
        return False


def insert_alert(topic: str, payload):
    """Insert into alerts table."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Ensure payload is a dict
        if isinstance(payload, str):
            payload = {"raw_text": payload}
        
        # Handle nested raw_text containing markdown-wrapped JSON
        actual_payload = payload
        if 'raw_text' in payload and isinstance(payload['raw_text'], str):
            actual_payload = parse_markdown_json(payload['raw_text'])
        
        # Extract key fields - alert details may be nested under 'alert' key
        alert_generated = actual_payload.get('alert_generated', False)
        alert_data = actual_payload.get('alert', {}) if alert_generated else {}
        
        transaction_id = alert_data.get('transaction_id') or actual_payload.get('transaction_id')
        alert_type = alert_data.get('alert_type') or ','.join(alert_data.get('detected_patterns', []))
        severity = alert_data.get('severity')
        reason = alert_data.get('description') or actual_payload.get('reason')
        
        payload_json = json.dumps(actual_payload).replace('\\u0000', '')
        
        cur.execute("""
            INSERT INTO alerts 
            (transaction_id, alert_generated, alert_type, severity, reason, topic, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
        """, (transaction_id, alert_generated, alert_type, severity, reason, topic, payload_json))
        
        conn.commit()
        cur.close()
        conn.close()
        
        if alert_generated:
            print(f"[{datetime.now().isoformat()}] ALERT: {transaction_id} {alert_type} {severity}")
        else:
            print(f"[{datetime.now().isoformat()}] alerts: no alert - {reason}")
        return True
    except Exception as e:
        print(f"[{datetime.now().isoformat()}] ERROR alerts: {e}")
        return False


def create_messaging_service():
    """Create and connect to Solace messaging service."""
    broker_props = {
        "solace.messaging.transport.host": os.getenv('SOLACE_BROKER_URL', 'ws://solace:8008'),
        "solace.messaging.service.vpn-name": os.getenv('SOLACE_BROKER_VPN', 'sam'),
        "solace.messaging.authentication.scheme.basic.username": os.getenv('SOLACE_BROKER_USERNAME', 'sam'),
        "solace.messaging.authentication.scheme.basic.password": os.getenv('SOLACE_BROKER_PASSWORD', 'sam'),
    }
    
    messaging_service = MessagingService.builder().from_properties(broker_props).build()
    messaging_service.connect()
    print(f"Connected to Solace broker at {broker_props['solace.messaging.transport.host']}")
    return messaging_service


def create_receiver(messaging_service, queue_name: str) -> PersistentMessageReceiver:
    """Create a persistent message receiver for a queue."""
    queue = Queue.durable_exclusive_queue(queue_name)
    receiver = messaging_service.create_persistent_message_receiver_builder().build(queue)
    receiver.start()
    print(f"Receiver started for queue: {queue_name}")
    return receiver


def process_raw_transactions(receiver: PersistentMessageReceiver):
    """Process raw transaction messages."""
    while True:
        try:
            message = receiver.receive_message(timeout=5000)
            if message:
                topic = message.get_destination_name()
                payload_bytes = message.get_payload_as_bytes()
                
                if payload_bytes:
                    payload_bytes = payload_bytes.replace(b'\x00', b'')
                    try:
                        payload_str = payload_bytes.decode('utf-8')
                    except UnicodeDecodeError:
                        payload_str = payload_bytes.decode('latin-1')
                else:
                    payload_str = '{}'
                
                try:
                    payload = json.loads(payload_str)
                except:
                    payload = {"raw_text": payload_str}
                
                if insert_raw_transaction(topic, payload):
                    receiver.ack(message)
        except Exception as e:
            print(f"[{datetime.now().isoformat()}] Error raw: {e}")
            time.sleep(1)


def process_scored_transactions(receiver: PersistentMessageReceiver):
    """Process scored transaction messages."""
    while True:
        try:
            message = receiver.receive_message(timeout=5000)
            if message:
                topic = message.get_destination_name()
                payload_bytes = message.get_payload_as_bytes()
                payload_str = payload_bytes.decode('utf-8') if payload_bytes else '{}'
                
                payload = parse_markdown_json(payload_str)
                
                if insert_scored_transaction(topic, payload):
                    receiver.ack(message)
        except Exception as e:
            print(f"[{datetime.now().isoformat()}] Error scored: {e}")
            time.sleep(1)


def process_alerts(receiver: PersistentMessageReceiver):
    """Process alert messages."""
    while True:
        try:
            message = receiver.receive_message(timeout=5000)
            if message:
                topic = message.get_destination_name()
                payload_bytes = message.get_payload_as_bytes()
                payload_str = payload_bytes.decode('utf-8') if payload_bytes else '{}'
                
                payload = parse_markdown_json(payload_str)
                
                if insert_alert(topic, payload):
                    receiver.ack(message)
        except Exception as e:
            print(f"[{datetime.now().isoformat()}] Error alert: {e}")
            time.sleep(1)


def main():
    print("Starting Solace-to-PostgreSQL persistence service (3 tables)...")
    time.sleep(5)
    
    messaging_service = create_messaging_service()
    
    # Start receivers with their specific handlers
    receivers = [
        ('fraud/q/db-raw-transactions', process_raw_transactions),
        ('fraud/q/db-scored-transactions', process_scored_transactions),
        ('fraud/q/db-alerts', process_alerts),
    ]
    
    threads = []
    for queue_name, handler in receivers:
        try:
            receiver = create_receiver(messaging_service, queue_name)
            thread = threading.Thread(target=handler, args=(receiver,), daemon=True)
            thread.start()
            threads.append(thread)
        except Exception as e:
            print(f"Failed to create receiver for {queue_name}: {e}")
    
    print(f"Started {len(threads)} message processing threads")
    print("Tables: raw_transactions, scored_transactions, alerts")
    
    try:
        while True:
            time.sleep(60)
            print(f"[{datetime.now().isoformat()}] Service running...")
    except KeyboardInterrupt:
        print("Shutting down...")
        messaging_service.disconnect()


if __name__ == '__main__':
    main()
