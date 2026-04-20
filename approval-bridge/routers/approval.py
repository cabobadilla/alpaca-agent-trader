"""
approval-bridge/routers/approval.py
-------------------------------------
FastAPI router for trade plan approval CRUD endpoints.

TODO: Implement:
  POST   /plans              — receive and store a new trade plan
  GET    /plans              — list all plans
  GET    /plans/{plan_id}    — retrieve a single plan
  GET    /plans/{plan_id}/status — return approval status
  POST   /plans/{plan_id}/decide — record APPROVE or REJECT decision
"""

import logging

from fastapi import APIRouter, HTTPException

from models.approval import ApprovalDecision, ApprovalStatusResponse
from models.tradeplan import TradePlan, TradePlanCreate
from services.approval_state import approval_state_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", status_code=201)
async def submit_plan(payload: TradePlanCreate) -> dict:
    """
    Accept a new trade plan from agent-c and store it pending approval.

    TODO: Implement storage and trigger email notification.
    """
    # TODO: implement
    logger.info("submit_plan called (stub)")
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("")
async def list_plans() -> list[dict]:
    """
    Return all trade plans (for the myAlpaca /approvals frontend page).

    TODO: Implement retrieval from approval_state_service.
    """
    # TODO: implement
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{plan_id}")
async def get_plan(plan_id: str) -> dict:
    """
    Return a single trade plan by ID.

    TODO: Implement lookup.
    """
    # TODO: implement
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{plan_id}/status", response_model=ApprovalStatusResponse)
async def get_plan_status(plan_id: str) -> ApprovalStatusResponse:
    """
    Return the current approval status for a plan.
    Polled by agent-c.

    TODO: Implement lookup from approval_state_service.
    """
    # TODO: implement
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/{plan_id}/decide", status_code=200)
async def decide_plan(plan_id: str, decision: ApprovalDecision) -> dict:
    """
    Record a human APPROVE or REJECT decision for a trade plan.
    Called by the myAlpaca frontend.

    TODO: Implement via approval_state_service.record_decision().
    """
    # TODO: implement
    logger.info("decide_plan called (stub): plan_id=%s decision=%s", plan_id, decision)
    raise HTTPException(status_code=501, detail="Not implemented")
