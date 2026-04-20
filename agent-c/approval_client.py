"""
agent-c/approval_client.py
--------------------------
HTTP client for the approval-bridge FastAPI service.

Responsibilities:
  - POST /plans        → submit a trade plan for human approval
  - GET /plans/{id}/status → poll approval status
  - POST /notification/send → send notification emails
  - poll_until_decided() → blocking poll with timeout
"""

import logging
import time

import httpx

logger = logging.getLogger(__name__)


class ApprovalBridgeClient:
    """Client for the approval-bridge service."""

    def __init__(self, base_url: str = "http://approval-bridge:8080") -> None:
        self.base_url = base_url.rstrip("/")

    def submit_plan(self, plan: dict) -> dict:
        """
        POST /plans — submit a trade plan for approval.

        Args:
            plan: Trade plan dict matching TradePlanCreate schema.

        Returns:
            Response dict: {plan_id, expires_at, message}
        """
        response = httpx.post(f"{self.base_url}/plans", json=plan, timeout=30)
        response.raise_for_status()
        result = response.json()
        logger.info(
            "Plan submitted to approval-bridge: %s (expires: %s)",
            result.get("plan_id"),
            result.get("expires_at"),
        )
        return result

    def get_status(self, plan_id: str) -> dict:
        """
        GET /plans/{plan_id}/status — poll the current approval status.

        Returns:
            Status dict: {plan_id, status, decision, decided_at, expires_at}
        """
        response = httpx.get(
            f"{self.base_url}/plans/{plan_id}/status", timeout=15
        )
        response.raise_for_status()
        return response.json()

    def send_notification(
        self,
        plan_id: str,
        ntype: str,
        subject: str,
        html: str,
    ) -> bool:
        """
        POST /notification/send — send an alert or info notification email.

        Returns:
            True if email was sent, False otherwise.
        """
        payload = {
            "plan_id": plan_id,
            "type": ntype,
            "email_subject": subject,
            "email_html": html,
        }
        try:
            response = httpx.post(
                f"{self.base_url}/notification/send", json=payload, timeout=15
            )
            response.raise_for_status()
            result = response.json()
            return result.get("email_sent", False)
        except httpx.RequestError as exc:
            logger.error("send_notification failed: %s", exc)
            return False

    def poll_until_decided(
        self,
        plan_id: str,
        timeout_minutes: int,
        interval_seconds: int = 120,
    ) -> str:
        """
        Poll approval status until a terminal state is reached.

        Terminal states: APPROVED, REJECTED, EXPIRED
        Returns 'TIMEOUT' if the timeout_minutes deadline elapses.

        Args:
            plan_id:          UUID of the plan to poll.
            timeout_minutes:  How long to poll before giving up.
            interval_seconds: How often to check (default 120s).

        Returns:
            One of: 'APPROVED', 'REJECTED', 'EXPIRED', 'TIMEOUT'
        """
        terminal_states = {"APPROVED", "REJECTED", "EXPIRED"}
        deadline = time.monotonic() + (timeout_minutes * 60)

        logger.info(
            "Polling approval for plan %s (timeout=%d min, interval=%ds)",
            plan_id,
            timeout_minutes,
            interval_seconds,
        )

        while time.monotonic() < deadline:
            try:
                status_data = self.get_status(plan_id)
                status = status_data.get("status", "")
                logger.debug("Plan %s status: %s", plan_id, status)

                if status in terminal_states:
                    logger.info("Plan %s reached terminal state: %s", plan_id, status)
                    return status
            except httpx.RequestError as exc:
                logger.warning("Status poll error for %s: %s", plan_id, exc)
            except Exception as exc:
                logger.error("Unexpected error polling %s: %s", plan_id, exc)

            # Check again before sleeping — avoid one extra sleep at deadline
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            sleep_time = min(interval_seconds, remaining)
            time.sleep(sleep_time)

        logger.warning("Approval poll timeout reached for plan %s", plan_id)
        return "TIMEOUT"
