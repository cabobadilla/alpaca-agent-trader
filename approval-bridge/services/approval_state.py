"""
approval-bridge/services/approval_state.py
-------------------------------------------
Manages the lifecycle and persistence of trade plan approval records.

TODO: Implement:
      - create_plan(plan: dict) → str  (returns plan_id)
      - get_plan(plan_id: str) → dict
      - list_plans() → list[dict]
      - get_status(plan_id: str) → ApprovalStatus
      - record_decision(plan_id: str, decision: str) → dict
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import config

logger = logging.getLogger(__name__)


class ApprovalStateService:
    """File-based persistence for approval records on the shared volume."""

    @property
    def _approvals_dir(self) -> Path:
        p = Path(config.APPROVALS_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _approval_path(self, plan_id: str) -> Path:
        return self._approvals_dir / f"approval_{plan_id}.json"

    def create_plan(self, plan: dict) -> str:
        """
        Persist a new trade plan approval record with PENDING status.

        TODO: Implement full record creation and persistence.

        Returns:
            plan_id string.
        """
        # TODO: implement
        logger.info("create_plan called (stub)")
        raise NotImplementedError("create_plan not yet implemented")

    def get_plan(self, plan_id: str) -> dict:
        """
        Load an approval record by plan_id.

        TODO: Implement file read with error handling.
        """
        # TODO: implement
        raise NotImplementedError("get_plan not yet implemented")

    def list_plans(self) -> list[dict]:
        """
        Return all approval records.

        TODO: Implement directory scan.
        """
        # TODO: implement
        raise NotImplementedError("list_plans not yet implemented")

    def get_status(self, plan_id: str) -> str:
        """
        Return the current approval status string for a plan.

        TODO: Implement via get_plan().
        """
        # TODO: implement
        raise NotImplementedError("get_status not yet implemented")

    def record_decision(self, plan_id: str, decision: str) -> dict:
        """
        Persist an APPROVE or REJECT decision and timestamp.

        TODO: Implement with validation (no re-deciding a closed plan).

        Args:
            plan_id:  UUID of the trade plan.
            decision: "APPROVED" or "REJECTED"

        Returns:
            Updated approval record dict.
        """
        # TODO: implement
        logger.info("record_decision called (stub): %s → %s", plan_id, decision)
        raise NotImplementedError("record_decision not yet implemented")


# Module-level singleton
approval_state_service = ApprovalStateService()
