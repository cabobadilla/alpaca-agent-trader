"""
approval-bridge/main.py
-----------------------
FastAPI application entry point for the approval-bridge service.

Exposes:
  GET  /health                  — liveness probe (returns 200 + {"status": "ok"})
  POST /plans                   — submit a trade plan for approval
  GET  /plans/pending           — list all pending plans
  GET  /plans/{id}/status       — poll approval status
  POST /plans/{id}/decide       — record APPROVE/REJECT decision
  POST /notification/send       — trigger email notification
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from config import config
from routers.approval import router as approval_router
from routers.notification import router as notification_router
from services.approval_state import approval_state_manager

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Alpaca Agent Trader — Approval Bridge",
    description="Handles trade plan approval workflow between agent-c and the user.",
    version="0.1.0",
)

# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(approval_router, prefix="/plans", tags=["approvals"])
app.include_router(notification_router, prefix="/notification", tags=["notifications"])


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health() -> dict:
    """Liveness probe — returns 200 when the service is running."""
    return {"status": "ok"}


# ── Background expiry task ────────────────────────────────────────────────────
async def _expire_plans_periodically() -> None:
    """Runs every 5 minutes and expires stale approval records."""
    while True:
        await asyncio.sleep(300)  # 5 minutes
        try:
            count = approval_state_manager.expire_old_plans()
            if count:
                logger.info("Expired %d old plan(s)", count)
        except Exception as exc:
            logger.error("Error in expire_old_plans background task: %s", exc)


@app.on_event("startup")
async def startup_event() -> None:
    """Create required directories and launch background tasks on startup."""
    # Ensure data directories exist
    for dir_path in [config.APPROVALS_DIR, config.TRADEPLANS_DIR]:
        Path(dir_path).mkdir(parents=True, exist_ok=True)
        logger.info("Ensured directory exists: %s", dir_path)

    # Start background expiry task
    asyncio.create_task(_expire_plans_periodically())
    logger.info("Background plan-expiry task started (interval: 5 min)")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level=config.LOG_LEVEL.lower(),
    )
