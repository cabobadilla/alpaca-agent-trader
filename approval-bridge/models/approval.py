"""
approval-bridge/models/approval.py
-------------------------------------
Pydantic models for approval records and decisions.

TODO: Extend with full field validation, example values, and JSON schema export.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ApprovalDecision(BaseModel):
    """Payload sent by the frontend to record a human approval decision."""

    # TODO: add validator to reject decisions on already-closed plans
    decision: ApprovalStatus = Field(
        ...,
        description="Human decision: APPROVED or REJECTED",
        examples=["APPROVED"],
    )
    decided_by: Optional[str] = Field(
        default=None,
        description="Optional: identifier of the user who made the decision",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Optional free-text notes from the approver",
    )


class ApprovalRecord(BaseModel):
    """Full approval record stored on disk and returned via API."""

    # TODO: add created_at / updated_at auto-population
    plan_id: str = Field(..., description="UUID of the associated trade plan")
    status: ApprovalStatus = Field(default=ApprovalStatus.PENDING)
    submitted_at: datetime = Field(..., description="When agent-c submitted the plan")
    decided_at: Optional[datetime] = Field(default=None)
    decided_by: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)


class ApprovalStatusResponse(BaseModel):
    """Minimal response model for the GET /plans/{id}/status endpoint."""

    plan_id: str
    status: ApprovalStatus
