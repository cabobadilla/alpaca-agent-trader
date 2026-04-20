"""
agent-c/config.py
-----------------
Loads all environment variables for agent-c (execution agent).
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    ANTHROPIC_API_KEY: str = os.environ["ANTHROPIC_API_KEY"]
    AGENT_C_CRON: str = os.getenv("AGENT_C_CRON", "0 9 * * 1-5")
    STRATEGIES_DIR: str = os.getenv("STRATEGIES_DIR", "/data/strategies")
    TRADEPLANS_DIR: str = os.getenv("TRADEPLANS_DIR", "/data/tradeplans")
    APPROVALS_DIR: str = os.getenv("APPROVALS_DIR", "/data/approvals")
    MYALPACA_BASE_URL: str = os.getenv("MYALPACA_BASE_URL", "http://myalpaca:3001")
    APPROVAL_BRIDGE_URL: str = os.getenv("APPROVAL_BRIDGE_URL", "http://approval-bridge:8080")
    APPROVAL_TIMEOUT_MINUTES: int = int(os.getenv("APPROVAL_TIMEOUT_MINUTES", "120"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    TZ: str = os.getenv("TZ", "America/New_York")


config = Config()
