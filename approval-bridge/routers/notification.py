"""
approval-bridge/routers/notification.py
-----------------------------------------
FastAPI router for outbound notification endpoints.

TODO: Implement:
  POST /notify — trigger email notification for a given plan_id
"""

import logging

from fastapi import APIRouter, HTTPException

from services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", status_code=202)
async def send_notification(payload: dict) -> dict:
    """
    Trigger an outbound approval email via Resend for a trade plan.

    Expected payload: {"plan_id": "<uuid>"}

    TODO: Validate payload, load plan details, call email_service.send_approval_email().
    """
    plan_id = payload.get("plan_id")
    if not plan_id:
        raise HTTPException(status_code=422, detail="plan_id is required")

    # TODO: implement real email dispatch
    logger.info("send_notification called (stub): plan_id=%s", plan_id)
    raise HTTPException(status_code=501, detail="Not implemented")
