"""
agent-b/agent.py
----------------
Core research logic for agent-b — calls GPT-4o-mini to produce
a weekly trading strategy markdown file.

TODO: Implement run_research() to:
      1. Build the prompt from prompts.py
      2. Call OpenAI GPT-4o-mini via the openai SDK
      3. Persist the result with storage.write_strategy()
      4. Retry up to 3 times with 15-minute gaps on failure
"""

import logging
from datetime import datetime, timezone

import openai

from config import config
from prompts import SYSTEM_PROMPT, RESEARCH_PROMPT_TEMPLATE
from storage import write_strategy

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 15 * 60  # 15 minutes


def run_research() -> None:
    """
    Entry point for agent-b's weekly research task.

    TODO: Implement full GPT-4o-mini API call with retry logic.
    """
    logger.info("agent-b: starting weekly research run")

    now = datetime.now(tz=timezone.utc)
    year, week, _ = now.isocalendar()

    prompt = RESEARCH_PROMPT_TEMPLATE.format(
        date=now.strftime("%Y-%m-%d"),
        week=f"{year}-W{week:02d}",
    )

    # TODO: wrap in retry loop (3 attempts, 15-min delay)
    client = openai.OpenAI(api_key=config.OPENAI_API_KEY)

    # TODO: replace stub with real API call
    # response = client.chat.completions.create(
    #     model="gpt-4o-mini",
    #     messages=[
    #         {"role": "system", "content": SYSTEM_PROMPT},
    #         {"role": "user", "content": prompt},
    #     ],
    # )
    # content = response.choices[0].message.content

    content = f"# Strategy GPT {year}-W{week:02d}\n\n> TODO: populate via GPT-4o-mini\n"
    write_strategy(content)

    logger.info("agent-b: research run complete")
