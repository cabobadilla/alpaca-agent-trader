"""
agent-a/config.py
-----------------
Loads all environment variables for agent-a (Claude Sonnet research agent).
"""

import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    anthropic_api_key: str = field(default_factory=lambda: os.environ["ANTHROPIC_API_KEY"])
    strategies_dir: str = field(default_factory=lambda: os.getenv("STRATEGIES_DIR", "/data/strategies"))
    agent_a_cron: str = field(default_factory=lambda: os.getenv("AGENT_A_CRON", "0 6 * * 1"))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))
    approval_bridge_url: str = field(default_factory=lambda: os.getenv("APPROVAL_BRIDGE_URL", "http://approval-bridge:8080"))
    tz: str = field(default_factory=lambda: os.getenv("TZ", "America/New_York"))

    # Legacy uppercase aliases for backward compatibility
    @property
    def ANTHROPIC_API_KEY(self) -> str:
        return self.anthropic_api_key

    @property
    def STRATEGIES_DIR(self) -> str:
        return self.strategies_dir

    @property
    def AGENT_A_CRON(self) -> str:
        return self.agent_a_cron

    @property
    def LOG_LEVEL(self) -> str:
        return self.log_level

    @property
    def APPROVAL_BRIDGE_URL(self) -> str:
        return self.approval_bridge_url

    @property
    def TZ(self) -> str:
        return self.tz


config = Config()
