"""
approval-bridge/services/approval_state.py
-------------------------------------------
Manages the lifecycle and persistence of trade plan approval records.
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from models.approval import ApprovalRecord, TradePlanCreate

logger = logging.getLogger(__name__)


class ApprovalStateManager:
    """File-based persistence for approval records on the shared volume."""

    def __init__(self) -> None:
        self.approvals_dir = Path(
            os.getenv("APPROVALS_DIR", "/data/approvals")
        )
        self.approval_timeout_minutes = int(
            os.getenv("APPROVAL_TIMEOUT_MINUTES", "120")
        )
        self.approvals_dir.mkdir(parents=True, exist_ok=True)

    def _plan_path(self, plan_id: str) -> Path:
        return self.approvals_dir / f"{plan_id}.json"

    def save_plan(self, plan: TradePlanCreate) -> ApprovalRecord:
        """
        Create a new approval record from a TradePlanCreate payload.
        Persists to {APPROVALS_DIR}/{plan_id}.json.
        Returns the newly created ApprovalRecord.
        """
        now = datetime.now(tz=timezone.utc)
        expires_at = now + timedelta(minutes=self.approval_timeout_minutes)

        record = ApprovalRecord(
            **plan.model_dump(),
            status="AWAITING_SEND",
            created_at=now.isoformat(),
            expires_at=expires_at.isoformat(),
        )

        path = self._plan_path(plan.plan_id)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        logger.info("Saved approval record: %s → %s", plan.plan_id, path)
        return record

    def get_status(self, plan_id: str) -> ApprovalRecord | None:
        """
        Load an approval record by plan_id.
        Returns None if the file does not exist.
        """
        path = self._plan_path(plan_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return ApprovalRecord(**data)
        except Exception as exc:
            logger.error("Failed to read approval record %s: %s", plan_id, exc)
            return None

    def set_decision(
        self,
        plan_id: str,
        decision: str,
        reason: str | None = None,
    ) -> ApprovalRecord:
        """
        Record an APPROVED or REJECTED decision on an existing plan.
        Updates decided_at, decision, rejection_reason and status.
        Returns the updated ApprovalRecord.
        Raises FileNotFoundError if plan does not exist.
        """
        record = self.get_status(plan_id)
        if record is None:
            raise FileNotFoundError(f"No approval record found for plan_id={plan_id}")

        now = datetime.now(tz=timezone.utc)
        record.decision = decision
        record.decided_at = now.isoformat()
        record.status = decision  # APPROVED or REJECTED
        if reason:
            record.rejection_reason = reason

        path = self._plan_path(plan_id)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        logger.info("Decision recorded: plan=%s → %s", plan_id, decision)
        return record

    def expire_old_plans(self) -> int:
        """
        Scan APPROVALS_DIR for plans in AWAITING_REPLY status that are past
        their expires_at timestamp.  Mark them as EXPIRED and persist.
        Returns the count of plans expired.
        """
        expired_count = 0
        now = datetime.now(tz=timezone.utc)

        for json_file in self.approvals_dir.glob("*.json"):
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                record = ApprovalRecord(**data)
            except Exception as exc:
                logger.warning("Skipping unreadable file %s: %s", json_file, exc)
                continue

            if record.status not in ("AWAITING_SEND", "EMAIL_SENT", "AWAITING_REPLY"):
                continue

            expires_at = datetime.fromisoformat(record.expires_at)
            if now > expires_at:
                record.status = "EXPIRED"
                json_file.write_text(record.model_dump_json(indent=2), encoding="utf-8")
                logger.info("Expired plan: %s", record.plan_id)
                expired_count += 1

        return expired_count

    def list_pending(self) -> list[ApprovalRecord]:
        """
        Return all records with status in (AWAITING_SEND, EMAIL_SENT, AWAITING_REPLY).
        """
        pending_statuses = {"AWAITING_SEND", "EMAIL_SENT", "AWAITING_REPLY"}
        results: list[ApprovalRecord] = []

        for json_file in self.approvals_dir.glob("*.json"):
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                record = ApprovalRecord(**data)
                if record.status in pending_statuses:
                    results.append(record)
            except Exception as exc:
                logger.warning("Skipping unreadable file %s: %s", json_file, exc)

        return results


# Module-level singleton
approval_state_manager = ApprovalStateManager()
