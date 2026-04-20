"""
approval-bridge/services/email_service.py
------------------------------------------
Sends approval notification emails via the Resend API.

TODO: Implement send_approval_email() to:
      1. Load the trade plan details
      2. Render templates/email_trade_plan.html via Jinja2
      3. Call resend.Emails.send() with the rendered HTML
"""

import logging

import resend

from config import config

logger = logging.getLogger(__name__)


class EmailService:
    """Wrapper around the Resend email API."""

    def __init__(self) -> None:
        resend.api_key = config.RESEND_API_KEY

    def send_approval_email(self, plan_id: str, plan_summary: str) -> dict:
        """
        Send an approval notification email for the given trade plan.

        TODO: Render HTML template with Jinja2 and send via Resend.

        Args:
            plan_id:      UUID of the trade plan.
            plan_summary: Human-readable summary to embed in the email.

        Returns:
            Resend API response dict.
        """
        # TODO: render Jinja2 template
        html_body = f"""
        <p>A new trade plan is ready for your approval.</p>
        <p><strong>Plan ID:</strong> {plan_id}</p>
        <pre>{plan_summary}</pre>
        <p>Visit the <a href="#">/approvals</a> page to APPROVE or REJECT.</p>
        """

        # TODO: implement real Resend call
        # response = resend.Emails.send({
        #     "from": config.RESEND_FROM_EMAIL,
        #     "to": [config.RESEND_TO_EMAIL],
        #     "subject": f"[Alpaca Trader] Trade Plan {plan_id} needs approval",
        #     "html": html_body,
        # })
        # return response

        logger.info("send_approval_email (stub): plan_id=%s", plan_id)
        raise NotImplementedError("send_approval_email not yet implemented")


# Module-level singleton
email_service = EmailService()
