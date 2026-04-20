"""
agent-a/agent.py
----------------
Core research logic for agent-a — calls Claude Sonnet to produce
a weekly trading strategy markdown file.

TODO: Implement run_research() to:
      1. Build the prompt from prompts.py
      2. Call Anthropic Claude Sonnet via the anthropic SDK
      3. Persist the result with storage.write_strategy()
      4. Retry up to 3 times with 15-minute gaps on failure
"""

import logging
from datetime import datetime, timezone

import anthropic

from config import config
from prompts import SYSTEM_PROMPT, RESEARCH_PROMPT_TEMPLATE
from storage import write_strategy

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 15 * 60  # 15 minutes


def run_research() -> None:
    """
    Entry point for agent-a's weekly research task.

    TODO: Implement full Claude Sonnet API call with retry logic.
    """
    logger.info("agent-a: starting weekly research run")

    now = datetime.now(tz=timezone.utc)
    year, week, _ = now.isocalendar()

    prompt = RESEARCH_PROMPT_TEMPLATE.format(
        date=now.strftime("%Y-%m-%d"),
        week=f"{year}-W{week:02d}",
    )

    # TODO: wrap in retry loop (3 attempts, 15-min delay)
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    # TODO: replace stub with real API call
    # message = client.messages.create(
    #     model="claude-sonnet-4-5",
    #     max_tokens=4096,
    #     system=SYSTEM_PROMPT,
    #     messages=[{"role": "user", "content": prompt}],
    # )
    # content = message.content[0].text

    content = f"# Strategy Claude {year}-W{week:02d}\n\n> TODO: populate via Claude Sonnet\n"
    write_strategy(content)

    logger.info("agent-a: research run complete")
