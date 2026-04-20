"""
approval-bridge/services/email_service.py
------------------------------------------
Sends approval notification emails via the Resend API using httpx (not the SDK).
"""

import logging
import os
from pathlib import Path

import httpx
from jinja2 import Environment, FileSystemLoader

from models.approval import ApprovalRecord

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


class EmailService:
    """Sends emails via the Resend REST API using httpx."""

    def __init__(self) -> None:
        self.api_key = os.environ.get("RESEND_API_KEY", "")
        self.from_email = os.environ.get("RESEND_FROM_EMAIL", "")
        self.to_email = os.environ.get("RESEND_TO_EMAIL", "")
        self._jinja_env = Environment(
            loader=FileSystemLoader(str(TEMPLATES_DIR)),
            autoescape=True,
        )

    def _send(self, subject: str, html: str) -> bool:
        """Low-level helper: POST to Resend API. Returns True on 200/201."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "from": self.from_email,
            "to": [self.to_email],
            "subject": subject,
            "html": html,
        }
        try:
            response = httpx.post(RESEND_API_URL, headers=headers, json=payload, timeout=15)
            if response.status_code in (200, 201):
                logger.info("Email sent: subject='%s'", subject)
                return True
            else:
                logger.error(
                    "Resend API error %d: %s", response.status_code, response.text
                )
                return False
        except httpx.RequestError as exc:
            logger.error("HTTP request failed: %s", exc)
            return False

    def send_plan_notification(self, plan: ApprovalRecord) -> bool:
        """
        Render the email_trade_plan.html Jinja2 template and send via Resend.
        Returns True on success, False on failure.
        """
        try:
            template = self._jinja_env.get_template("email_trade_plan.html")
            html = template.render(plan=plan)
        except Exception as exc:
            logger.error("Template render failed: %s", exc)
            return False

        subject = f"Trade Plan Ready for Approval \u2014 {plan.date}"
        return self._send(subject, html)

    def send_alert(self, subject: str, message: str) -> bool:
        """Send a plain-text alert email (wrapped in minimal HTML)."""
        html = f"<html><body><p>{message}</p></body></html>"
        return self._send(subject, html)

    def send_execution_confirmation(self, plan_id: str, summary: dict) -> bool:
        """Send a post-execution confirmation email with a summary."""
        rows = "".join(
            f"<tr><td>{k}</td><td>{v}</td></tr>"
            for k, v in summary.items()
        )
        html = f"""
        <html><body>
        <h2>Execution Confirmation — Plan {plan_id}</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        </body></html>
        """
        subject = f"Execution Confirmation — Plan {plan_id}"
        return self._send(subject, html)


# Module-level singleton
email_service = EmailService()
