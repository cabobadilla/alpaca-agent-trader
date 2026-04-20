"""
approval-bridge/config.py
-------------------------
Loads all environment variables for the approval-bridge FastAPI service.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    RESEND_FROM_EMAIL: str = os.getenv("RESEND_FROM_EMAIL", "")
    RESEND_TO_EMAIL: str = os.getenv("RESEND_TO_EMAIL", "")
    TRADEPLANS_DIR: str = os.getenv("TRADEPLANS_DIR", "/data/tradeplans")
    APPROVALS_DIR: str = os.getenv("APPROVALS_DIR", "/data/approvals")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    TZ: str = os.getenv("TZ", "America/New_York")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8080"))


config = Config()
