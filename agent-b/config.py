"""
agent-b/config.py
-----------------
Loads all environment variables for agent-b (GPT-4o-mini research agent).
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    OPENAI_API_KEY: str = os.environ["OPENAI_API_KEY"]
    AGENT_B_CRON: str = os.getenv("AGENT_B_CRON", "0 6 * * 1")
    STRATEGIES_DIR: str = os.getenv("STRATEGIES_DIR", "/data/strategies")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    TZ: str = os.getenv("TZ", "America/New_York")


config = Config()
