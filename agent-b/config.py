"""
agent-b/config.py
-----------------
Loads all environment variables for agent-b (GPT-4o-mini research agent).
"""

import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    openai_api_key: str = field(default_factory=lambda: os.environ["OPENAI_API_KEY"])
    strategies_dir: str = field(default_factory=lambda: os.getenv("STRATEGIES_DIR", "/data/strategies"))
    agent_b_cron: str = field(default_factory=lambda: os.getenv("AGENT_B_CRON", "0 6 * * 1"))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))
    approval_bridge_url: str = field(default_factory=lambda: os.getenv("APPROVAL_BRIDGE_URL", "http://approval-bridge:8080"))
    tz: str = field(default_factory=lambda: os.getenv("TZ", "America/New_York"))

    # Legacy uppercase aliases for backward compatibility
    @property
    def OPENAI_API_KEY(self) -> str:
        return self.openai_api_key

    @property
    def STRATEGIES_DIR(self) -> str:
        return self.strategies_dir

    @property
    def AGENT_B_CRON(self) -> str:
        return self.agent_b_cron

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
