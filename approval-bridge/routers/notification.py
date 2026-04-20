"""
approval-bridge/routers/notification.py
-----------------------------------------
FastAPI router for outbound notification endpoints.
Prefix: /notification
"""

import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter()


class NotificationRequest(BaseModel):
    plan_id: str
    type: str
    email_subject: str
    email_html: str


class NotificationResponse(BaseModel):
    email_sent: bool
    errors: list[str]


@router.post("/send", response_model=NotificationResponse)
async def send_notification(payload: NotificationRequest) -> NotificationResponse:
    """
    Trigger an outbound alert email.
    Accepts {plan_id, type, email_subject, email_html} and sends via EmailService.send_alert().
    """
    errors: list[str] = []
    sent = False

    try:
        sent = email_service.send_alert(
            subject=payload.email_subject,
            message=payload.email_html,
        )
        if not sent:
            errors.append("Email delivery failed — check RESEND_API_KEY and email config.")
    except Exception as exc:
        errors.append(str(exc))
        logger.error("Notification send error for plan %s: %s", payload.plan_id, exc)

    return NotificationResponse(email_sent=sent, errors=errors)
