"""
approval-bridge/main.py
-----------------------
FastAPI application entry point for the approval-bridge service.

Exposes:
  GET  /health            — liveness probe (returns 200 + {"status": "ok"})
  POST /plans             — submit a trade plan for approval (see routers/approval.py)
  GET  /plans/{id}/status — poll approval status         (see routers/approval.py)
  POST /plans/{id}/decide — record APPROVE/REJECT         (see routers/approval.py)
  POST /notify            — trigger email notification   (see routers/notification.py)
"""

import logging
import sys

import uvicorn
from fastapi import FastAPI

from config import config
from routers.approval import router as approval_router
from routers.notification import router as notification_router

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
app.include_router(notification_router, prefix="/notify", tags=["notifications"])


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health() -> dict:
    """Liveness probe — returns 200 when the service is running."""
    return {"status": "ok"}


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level=config.LOG_LEVEL.lower(),
    )
