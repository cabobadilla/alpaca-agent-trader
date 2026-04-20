"""
agent-a/config.py
-----------------
Loads all environment variables for agent-a (Claude Sonnet research agent).
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    ANTHROPIC_API_KEY: str = os.environ["ANTHROPIC_API_KEY"]
    AGENT_A_CRON: str = os.getenv("AGENT_A_CRON", "0 6 * * 1")
    STRATEGIES_DIR: str = os.getenv("STRATEGIES_DIR", "/data/strategies")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    TZ: str = os.getenv("TZ", "America/New_York")


config = Config()
