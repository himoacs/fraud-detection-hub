"""
Solace Agent Mesh (SAM) SDK Stub

This module provides the base classes and interfaces for SAM agents.
In production, this would be the actual solace-agent-mesh package.
"""

import asyncio
import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional

import solace.messaging
from solace.messaging.messaging_service import MessagingService
from solace.messaging.receiver.message_receiver import MessageHandler
from solace.messaging.resources.topic_subscription import TopicSubscription
from solace.messaging.publisher.direct_message_publisher import DirectMessagePublisher


@dataclass
class AgentConfig:
    """Configuration for a SAM agent"""
    name: str
    description: str = ""
    subscriptions: List[str] = field(default_factory=list)
    publications: List[str] = field(default_factory=list)
    version: str = "1.0.0"


@dataclass
class Message:
    """Wrapper for Solace messages"""
    topic: str
    payload: str
    properties: dict = field(default_factory=dict)
    timestamp: str = ""


class Agent(ABC):
    """Base class for SAM agents"""

    def __init__(self, config: AgentConfig):
        self.config = config
        self.logger = logging.getLogger(config.name)
        self.logger.setLevel(logging.DEBUG)
        
        # Configure logging
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(
            f'[%(asctime)s] [{config.name}] %(levelname)s: %(message)s'
        ))
        self.logger.addHandler(handler)
        
        # Solace connection
        self.messaging_service: Optional[MessagingService] = None
        self.publisher: Optional[DirectMessagePublisher] = None
        self._running = False

    def connect(self) -> None:
        """Connect to Solace broker"""
        broker_props = {
            "solace.messaging.transport.host": os.getenv("SOLACE_HOST", "ws://localhost:8008"),
            "solace.messaging.service.vpn-name": os.getenv("SOLACE_VPN", "default"),
            "solace.messaging.authentication.scheme.basic.username": os.getenv("SOLACE_USERNAME", "demo"),
            "solace.messaging.authentication.scheme.basic.password": os.getenv("SOLACE_PASSWORD", "demo"),
        }
        
        self.messaging_service = MessagingService.builder().from_properties(broker_props).build()
        self.messaging_service.connect()
        
        self.publisher = self.messaging_service.create_direct_message_publisher_builder().build()
        self.publisher.start()
        
        self.logger.info(f"Connected to Solace broker")

    def subscribe(self) -> None:
        """Subscribe to configured topics"""
        receiver = self.messaging_service.create_direct_message_receiver_builder()
        
        for topic_pattern in self.config.subscriptions:
            subscription = TopicSubscription.of(topic_pattern)
            receiver.with_subscriptions([subscription])
        
        receiver = receiver.build()
        receiver.start()
        receiver.receive_async(self._message_handler)
        
        self.logger.info(f"Subscribed to: {self.config.subscriptions}")

    def _message_handler(self, message: Any) -> None:
        """Internal message handler that wraps process_message"""
        try:
            topic = message.get_destination_name()
            payload = message.get_payload_as_string() or message.get_payload_as_bytes().decode()
            
            msg = Message(
                topic=topic,
                payload=payload,
                timestamp=message.get_timestamp() if hasattr(message, 'get_timestamp') else "",
            )
            
            # Run async process_message in event loop
            asyncio.get_event_loop().run_until_complete(self.process_message(msg))
            
        except Exception as e:
            self.logger.error(f"Error in message handler: {e}")

    async def publish(self, topic: str, payload: str) -> None:
        """Publish a message to a topic"""
        if not self.publisher:
            raise RuntimeError("Not connected to Solace")
        
        from solace.messaging.resources.topic import Topic
        
        destination = Topic.of(topic)
        self.publisher.publish(payload, destination)

    @abstractmethod
    async def process_message(self, message: Message) -> None:
        """Process an incoming message - must be implemented by subclasses"""
        pass

    def run(self) -> None:
        """Start the agent"""
        self.logger.info(f"Starting agent: {self.config.name} v{self.config.version}")
        
        try:
            self.connect()
            self.subscribe()
            self._running = True
            
            self.logger.info(f"Agent {self.config.name} is running")
            
            # Keep running until interrupted
            while self._running:
                asyncio.get_event_loop().run_until_complete(asyncio.sleep(1))
                
        except KeyboardInterrupt:
            self.logger.info("Shutting down...")
        finally:
            self.stop()

    def stop(self) -> None:
        """Stop the agent"""
        self._running = False
        if self.publisher:
            self.publisher.terminate()
        if self.messaging_service:
            self.messaging_service.disconnect()
        self.logger.info(f"Agent {self.config.name} stopped")
