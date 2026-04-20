"""
agent-c/config.py
-----------------
Loads all environment variables for agent-c (execution agent).
"""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    ANTHROPIC_API_KEY: str = field(
        default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", "")
    )
    STRATEGIES_DIR: str = field(
        default_factory=lambda: os.getenv("STRATEGIES_DIR", "/data/strategies")
    )
    TRADEPLANS_DIR: str = field(
        default_factory=lambda: os.getenv("TRADEPLANS_DIR", "/data/tradeplans")
    )
    MYALPACA_BASE_URL: str = field(
        default_factory=lambda: os.getenv("MYALPACA_BASE_URL", "http://myalpaca:3001")
    )
    APPROVAL_BRIDGE_URL: str = field(
        default_factory=lambda: os.getenv(
            "APPROVAL_BRIDGE_URL", "http://approval-bridge:8080"
        )
    )
    AGENT_C_CRON: str = field(
        default_factory=lambda: os.getenv("AGENT_C_CRON", "0 9 * * 1-5")
    )
    APPROVAL_TIMEOUT_MINUTES: int = field(
        default_factory=lambda: int(os.getenv("APPROVAL_TIMEOUT_MINUTES", "120"))
    )
    LOG_LEVEL: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))
    TZ: str = field(default_factory=lambda: os.getenv("TZ", "America/New_York"))


config = Config()
