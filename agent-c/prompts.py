"""
agent-c/prompts.py
------------------
Prompt templates for the agent-c execution agent (Claude Sonnet).

TODO: Define prompts for:
      - Synthesising agent-a and agent-b strategy files into a trade plan
      - Validating the trade plan structure before submission
"""

# TODO: Replace with production prompt content

SYSTEM_PROMPT = """
You are a disciplined algorithmic trading execution assistant.
Given one or two weekly research strategy reports, you produce a concrete,
JSON-serialisable trade plan that specifies exact orders to submit via the
Alpaca brokerage API.
"""

TRADE_PLAN_PROMPT_TEMPLATE = """
Today: {date}
Week: {week}

Research strategies available:
{strategies_summary}

Produce a JSON trade plan with the following schema:
{{
  "week": "<YYYY-WW>",
  "created_at": "<ISO8601>",
  "orders": [
    {{
      "symbol": "<TICKER>",
      "side": "buy|sell",
      "qty": <int>,
      "order_type": "market|limit",
      "limit_price": <float|null>,
      "time_in_force": "day|gtc"
    }}
  ],
  "rationale": "<brief explanation>"
}}

Output only valid JSON.
"""
