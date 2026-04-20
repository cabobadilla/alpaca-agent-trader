"""
approval-bridge/routers/approval.py
-------------------------------------
FastAPI router for trade plan approval endpoints.
Prefix: /plans
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

from models.approval import (
    ApprovalDecision,
    ApprovalRecord,
    ApprovalStatusResponse,
    TradePlanCreate,
)
from services.approval_state import approval_state_manager
from services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _send_plan_email(record: ApprovalRecord) -> None:
    """Background task: send plan notification and update record status."""
    sent = email_service.send_plan_notification(record)
    if sent:
        try:
            # Mark as EMAIL_SENT then AWAITING_REPLY
            rec = approval_state_manager.get_status(record.plan_id)
            if rec and rec.status == "AWAITING_SEND":
                from datetime import datetime, timezone
                rec.status = "EMAIL_SENT"
                from services.approval_state import approval_state_manager as _m
                import json
                from pathlib import Path
                path = _m.approvals_dir / f"{rec.plan_id}.json"
                path.write_text(rec.model_dump_json(indent=2), encoding="utf-8")
                logger.info("Email sent, plan status → EMAIL_SENT: %s", record.plan_id)
        except Exception as exc:
            logger.error("Failed to update email_sent status for %s: %s", record.plan_id, exc)
    else:
        logger.warning("Email send failed for plan %s", record.plan_id)


@router.post("", status_code=201)
async def submit_plan(
    payload: TradePlanCreate,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    """
    Accept a new trade plan from agent-c and store it pending approval.
    Returns 409 if a plan with the same date already exists.
    """
    # Check for duplicate plan for today's date
    pending = approval_state_manager.list_pending()
    all_plans: list[ApprovalRecord] = []
    # Also check non-pending (could be expired/approved/rejected from today)
    for json_file in approval_state_manager.approvals_dir.glob("*.json"):
        try:
            import json as _json
            data = _json.loads(json_file.read_text(encoding="utf-8"))
            all_plans.append(ApprovalRecord(**data))
        except Exception:
            pass

    for existing in all_plans:
        if existing.date == payload.date:
            raise HTTPException(
                status_code=409,
                detail=f"A trade plan for date {payload.date} already exists: {existing.plan_id}",
            )

    record = approval_state_manager.save_plan(payload)
    background_tasks.add_task(_send_plan_email, record)

    return JSONResponse(
        status_code=201,
        content={
            "plan_id": record.plan_id,
            "expires_at": record.expires_at,
            "message": "Trade plan received and email notification queued.",
        },
    )


@router.get("/pending")
async def list_pending_plans() -> list[ApprovalRecord]:
    """Return all plans with pending status (AWAITING_SEND, EMAIL_SENT, AWAITING_REPLY)."""
    return approval_state_manager.list_pending()


@router.get("/{plan_id}/status", response_model=ApprovalStatusResponse)
async def get_plan_status(plan_id: str) -> ApprovalStatusResponse:
    """Return the current approval status for a plan. Polled by agent-c."""
    record = approval_state_manager.get_status(plan_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")

    return ApprovalStatusResponse(
        plan_id=record.plan_id,
        status=record.status,
        decision=record.decision,
        decided_at=record.decided_at,
        expires_at=record.expires_at,
    )


@router.post("/{plan_id}/decide", response_model=ApprovalStatusResponse)
async def decide_plan(plan_id: str, decision: ApprovalDecision) -> ApprovalStatusResponse:
    """Record a human APPROVE or REJECT decision for a trade plan."""
    if decision.plan_id != plan_id:
        raise HTTPException(
            status_code=422,
            detail="plan_id in path and body must match",
        )

    existing = approval_state_manager.get_status(plan_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")

    try:
        record = approval_state_manager.set_decision(
            plan_id=plan_id,
            decision=decision.decision,
            reason=decision.reason,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")

    return ApprovalStatusResponse(
        plan_id=record.plan_id,
        status=record.status,
        decision=record.decision,
        decided_at=record.decided_at,
        expires_at=record.expires_at,
    )
