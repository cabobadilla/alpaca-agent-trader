"""
agent-c/agent.py
----------------
Core trade plan generation logic using Anthropic Claude.
"""

import json
import logging
import os
import re
from datetime import datetime, timezone

import anthropic

from prompts import EXECUTION_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

REQUIRED_KEYS = {
    "plan_id",
    "date",
    "summary",
    "trades",
    "portfolio_snapshot",
    "total_notional",
    "risk_summary",
    "agent_reasoning",
    "strategy_agreement_score",
    "key_disagreements",
}


def build_trade_plan(
    claude_strategy: str,
    gpt_strategy: str,
    account: dict,
    positions: list,
    orders: list,
) -> dict | None:
    """
    Call Claude claude-sonnet-4-6 to synthesise a trade plan from both strategy docs
    and the current portfolio state.

    Args:
        claude_strategy: Markdown content from agent-a's strategy file.
        gpt_strategy:    Markdown content from agent-b's strategy file.
        account:         Account dict (equity, cash, buying_power, ...).
        positions:       List of current open positions.
        orders:          List of current open orders.

    Returns:
        Parsed plan dict, or None on failure.
    """
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")

    user_message = f"""Today's date: {today}

=== PORTFOLIO STATE ===
Account:
{json.dumps(account, indent=2)}

Open Positions:
{json.dumps(positions, indent=2)}

Open Orders:
{json.dumps(orders, indent=2)}

=== CLAUDE STRATEGY RESEARCH ===
{claude_strategy}

=== GPT STRATEGY RESEARCH ===
{gpt_strategy}

Based on the above portfolio state and both research documents, produce a trade plan JSON as specified in your system instructions.
"""

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY is not set")
        return None

    client = anthropic.Anthropic(api_key=api_key)

    try:
        logger.info("Calling Claude claude-sonnet-4-6 to build trade plan…")
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            temperature=0.1,
            system=EXECUTION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.APIError as exc:
        logger.error("Anthropic API error: %s", exc)
        return None
    except Exception as exc:
        logger.error("Unexpected error calling Anthropic API: %s", exc)
        return None

    raw_text = message.content[0].text.strip()

    # Strip markdown code fences if present
    raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
    raw_text = re.sub(r"\s*```$", "", raw_text)
    raw_text = raw_text.strip()

    try:
        plan = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse JSON from Claude response: %s", exc)
        logger.debug("Raw response: %s", raw_text[:500])
        return None

    # Validate required keys
    missing = REQUIRED_KEYS - set(plan.keys())
    if missing:
        logger.error("Trade plan missing required keys: %s", missing)
        return None

    logger.info(
        "Trade plan built: %d trades, agreement=%.2f",
        len(plan.get("trades", [])),
        plan.get("strategy_agreement_score", 0.0),
    )
    return plan
