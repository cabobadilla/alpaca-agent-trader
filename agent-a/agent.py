"""
agent-a/agent.py
----------------
Core research logic for agent-a — calls Claude Sonnet to produce a
weekly trading strategy markdown file.

Public API:
    run_research() -> bool
    run_research_with_retry() -> bool
"""

import logging
import time
from datetime import datetime, timezone

import anthropic
import httpx

from config import config
from prompts import WEEKLY_RESEARCH_PROMPT
import storage
from event_logger import EventLogger

_elog = EventLogger(agent="agent-a")

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
      2. Call Anthropic claude-sonnet-4-6 with WEEKLY_RESEARCH_PROMPT.
      3. Validate all 7 required section headers are present.
      4. If valid, write to strategy_claude_{YYYY}-{WW}.md and return True.
      5. If invalid, log an error and return False.
    """
    logger.info("agent-a: starting weekly research run")

    date_str, week_num = _get_week_info()
    user_message = f"Generate weekly strategy for week {week_num}, starting {date_str}"

    try:
        client = anthropic.Anthropic(api_key=config.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=WEEKLY_RESEARCH_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        content = message.content[0].text
    except Exception as exc:
        logger.error("Anthropic API call failed: %s", exc, exc_info=True)
        return False

    if not _validate_sections(content):
        return False

    filename = f"strategy_claude_{week_num}.md"
    success = storage.write_strategy(content, filename)
    if success:
        logger.info("agent-a: research run complete — wrote %s", filename)
    else:
        logger.error("agent-a: research completed but failed to write file %s", filename)
    return success


def run_research_with_retry() -> bool:
    """
    Attempt run_research() up to MAX_RETRIES (3) times.

    On each failure, wait RETRY_DELAY_SECONDS (15 minutes) before retrying.
    After all attempts fail, send an alert via the approval-bridge notification
    endpoint and return False.

    Returns True as soon as any attempt succeeds.
    """
    _elog.phase("researching", message="Starting research run")
    for attempt in range(1, MAX_RETRIES + 1):
        logger.info("agent-a: research attempt %d/%d", attempt, MAX_RETRIES)
        if attempt > 1:
            _elog.phase(
                "retrying",
                message=f"Retry attempt {attempt}/{MAX_RETRIES}",
                metadata={"attempt": attempt, "max": MAX_RETRIES},
            )
        if run_research():
            logger.info("agent-a: research succeeded on attempt %d", attempt)
            _elog.phase("complete", message=f"Research complete on attempt {attempt}")
            return True

        if attempt < MAX_RETRIES:
            logger.warning(
                "agent-a: attempt %d failed — retrying in %d seconds",
                attempt,
                RETRY_DELAY_SECONDS,
            )
            time.sleep(RETRY_DELAY_SECONDS)
        else:
            logger.error("agent-a: all %d attempts failed", MAX_RETRIES)

    _elog.error(f"All {MAX_RETRIES} research attempts failed")
    _send_failure_alert()
    return False


def _send_failure_alert() -> None:
    """POST an alert to the approval-bridge notification endpoint."""
    url = f"{config.approval_bridge_url}/notification/send"
    payload = {
        "plan_id": "agent-a-alert",
        "type": "CUSTOM",
        "email_subject": "Agent A Research Failed",
        "email_html": "<p>Agent A failed after 3 attempts</p>",
    }
    try:
        response = httpx.post(url, json=payload, timeout=30)
        response.raise_for_status()
        logger.info("agent-a: failure alert sent to %s", url)
    except Exception as exc:
        logger.error("agent-a: failed to send failure alert to %s: %s", url, exc, exc_info=True)
