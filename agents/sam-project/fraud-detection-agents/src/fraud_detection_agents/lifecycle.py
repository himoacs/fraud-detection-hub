"""
Lifecycle functions for the Fraud Detection agents.
"""

from typing import Any
from pydantic import BaseModel, Field
from solace_ai_connector.common.log import log


class FraudAgentInitConfig(BaseModel):
    """Configuration for fraud agent initialization."""
    log_level: str = Field(default="INFO", description="Logging level")


def initialize_fraud_agent(host_component: Any, init_config: FraudAgentInitConfig):
    """
    Initializes a fraud detection agent.
    
    Args:
        host_component: The agent host component
        init_config: Validated initialization configuration
    """
    log_identifier = f"[{host_component.agent_name}:init]"
    log.info(f"{log_identifier} Starting fraud agent initialization...")
    
    # Store initial state
    host_component.set_agent_specific_state("transactions_processed", 0)
    host_component.set_agent_specific_state("initialized_at", __import__("datetime").datetime.now().isoformat())
    
    log.info(f"{log_identifier} Fraud agent initialization completed")


def cleanup_fraud_agent(host_component: Any):
    """
    Cleans up resources when a fraud agent shuts down.
    
    Args:
        host_component: The agent host component
    """
    log_identifier = f"[{host_component.agent_name}:cleanup]"
    log.info(f"{log_identifier} Starting fraud agent cleanup...")
    
    # Log final stats
    processed = host_component.get_agent_specific_state("transactions_processed", 0)
    log.info(f"{log_identifier} Agent processed {processed} transactions during its lifetime")
    
    log.info(f"{log_identifier} Fraud agent cleanup completed")
