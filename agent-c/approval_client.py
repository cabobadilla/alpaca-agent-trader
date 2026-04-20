"""
agent-c/approval_client.py
--------------------------
HTTP client for the approval-bridge FastAPI service.

Responsibilities:
  - POST /plans        → submit a trade plan for human approval
  - GET /plans/{id}/status → poll approval status
  - Agent-c waits up to APPROVAL_TIMEOUT_MINUTES for a decision

TODO: Implement full polling loop with timeout and backoff.
"""

import logging
import time
from datetime import datetime, timezone, timedelta
from enum import Enum

import httpx

from config import config

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ApprovalClient:
    """Client for the approval-bridge service."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or config.APPROVAL_BRIDGE_URL).rstrip("/")

    def submit_plan(self, plan: dict) -> str:
        """
        POST the trade plan to approval-bridge.

        TODO: Implement real HTTP POST /plans.

        Returns:
            plan_id string returned by approval-bridge.
        """
        # TODO: implement
        logger.info("submit_plan called (stub): plan_id=%s", plan.get("id"))
        raise NotImplementedError("submit_plan not yet implemented")

    def get_status(self, plan_id: str) -> ApprovalStatus:
        """
        GET /plans/{plan_id}/status from approval-bridge.

        TODO: Implement real HTTP GET.

        Returns:
            ApprovalStatus enum value.
        """
        # TODO: implement
        raise NotImplementedError("get_status not yet implemented")

    def wait_for_approval(self, plan_id: str) -> ApprovalStatus:
        """
        Poll approval status until APPROVED/REJECTED or timeout.

        Polls every POLL_INTERVAL_SECONDS seconds.
        Gives up after config.APPROVAL_TIMEOUT_MINUTES minutes.

        TODO: Replace stub with real polling loop.

        Returns:
            Final ApprovalStatus.
        """
        timeout_at = datetime.now(tz=timezone.utc) + timedelta(
            minutes=config.APPROVAL_TIMEOUT_MINUTES
        )
        logger.info(
            "Waiting for approval of plan %s (timeout %d min)",
            plan_id,
            config.APPROVAL_TIMEOUT_MINUTES,
        )

        while datetime.now(tz=timezone.utc) < timeout_at:
            # TODO: replace with self.get_status(plan_id)
            logger.debug("Polling approval status for plan %s (stub)", plan_id)
            time.sleep(POLL_INTERVAL_SECONDS)

        logger.warning("Approval timeout reached for plan %s", plan_id)
        return ApprovalStatus.EXPIRED


# Module-level singleton
approval_client = ApprovalClient()
