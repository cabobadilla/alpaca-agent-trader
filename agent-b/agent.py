"""
agent-b/agent.py
----------------
Core research logic for agent-b — calls OpenAI GPT-4o-mini to produce
a weekly trading strategy markdown file.

Public API:
    run_research() -> bool
    run_research_with_retry() -> bool
"""

import logging
import time
from datetime import datetime, timezone

import httpx
import openai

from config import config
from prompts import WEEKLY_RESEARCH_PROMPT
import storage

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 15 * 60  # 15 minutes

REQUIRED_SECTIONS = [
    "## Macro Environment",
    "## Sector Momentum",
    "## Earnings Calendar Flags",
    "## Top 5 Ticker Recommendations",
    "## Overall Portfolio Risk Level",
    "## Key Risks",
    "## Reasoning Summary",
]


def _get_week_info() -> tuple[str, str]:
    """
    Return (date_str, week_num) where:
      - date_str is today's date in YYYY-MM-DD format
      - week_num is the ISO week formatted as YYYY-WW (zero-padded)
    """
    now = datetime.now(tz=timezone.utc)
    year, week, _ = now.isocalendar()
    date_str = now.strftime("%Y-%m-%d")
    week_num = f"{year}-{week:02d}"
    return date_str, week_num


def _validate_sections(content: str) -> bool:
    """Return True if all 7 required section headers are present in content."""
    missing = [sec for sec in REQUIRED_SECTIONS if sec not in content]
    if missing:
        logger.error(
            "Research output missing required sections: %s",
            missing,
        )
        return False
    return True


def run_research() -> bool:
    """
    Run a single research cycle:
      1. Build the user prompt with today's date and ISO week number.
      2. Call OpenAI gpt-4o-mini with WEEKLY_RESEARCH_PROMPT.
      3. Validate all 7 required section headers are present.
      4. If valid, write to strategy_gpt_{YYYY}-{WW}.md and return True.
      5. If invalid, log an error and return False.
    """
    logger.info("agent-b: starting weekly research run")

    date_str, week_num = _get_week_info()
    user_message = f"Generate weekly strategy for week {week_num}, starting {date_str}"

    try:
        client = openai.OpenAI(api_key=config.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": WEEKLY_RESEARCH_PROMPT},
                {"role": "user", "content": user_message},
            ],
        )
        content = response.choices[0].message.content
    except Exception as exc:
        logger.error("OpenAI API call failed: %s", exc, exc_info=True)
        return False

    if not _validate_sections(content):
        return False

    filename = f"strategy_gpt_{week_num}.md"
    success = storage.write_strategy(content, filename)
    if success:
        logger.info("agent-b: research run complete — wrote %s", filename)
    else:
        logger.error("agent-b: research completed but failed to write file %s", filename)
    return success


def run_research_with_retry() -> bool:
    """
    Attempt run_research() up to MAX_RETRIES (3) times.

    On each failure, wait RETRY_DELAY_SECONDS (15 minutes) before retrying.
    After all attempts fail, send an alert via the approval-bridge notification
    endpoint and return False.

    Returns True as soon as any attempt succeeds.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        logger.info("agent-b: research attempt %d/%d", attempt, MAX_RETRIES)
        if run_research():
            logger.info("agent-b: research succeeded on attempt %d", attempt)
            return True

        if attempt < MAX_RETRIES:
            logger.warning(
                "agent-b: attempt %d failed — retrying in %d seconds",
                attempt,
                RETRY_DELAY_SECONDS,
            )
            time.sleep(RETRY_DELAY_SECONDS)
        else:
            logger.error("agent-b: all %d attempts failed", MAX_RETRIES)

    # All attempts exhausted — send alert
    _send_failure_alert()
    return False


def _send_failure_alert() -> None:
    """POST an alert to the approval-bridge notification endpoint."""
    url = f"{config.approval_bridge_url}/notification/send"
    payload = {
        "plan_id": "agent-b-alert",
        "type": "CUSTOM",
        "email_subject": "Agent B Research Failed",
        "email_html": "<p>Agent B failed after 3 attempts</p>",
    }
    try:
        response = httpx.post(url, json=payload, timeout=30)
        response.raise_for_status()
        logger.info("agent-b: failure alert sent to %s", url)
    except Exception as exc:
        logger.error("agent-b: failed to send failure alert to %s: %s", url, exc, exc_info=True)
