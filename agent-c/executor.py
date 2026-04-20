"""
agent-c/executor.py
-------------------
Executes approved trade plans via the myAlpaca client.

TODO: Implement execute_plan() to:
      1. Parse orders from the approved trade plan
      2. Submit each order via MyAlpacaClient.submit_order()
      3. Log and record execution results
      4. Handle partial fills and order errors gracefully
"""

import logging
from pathlib import Path

from myalpaca_client import myalpaca_client
from storage import read_trade_plan

logger = logging.getLogger(__name__)


def execute_plan(plan_id: str) -> list[dict]:
    """
    Execute all orders in an approved trade plan.

    TODO: Implement full execution loop with per-order error handling.

    Args:
        plan_id: UUID string identifying the trade plan to execute.

    Returns:
        List of execution result dicts (one per order).
    """
    logger.info("Executing trade plan: %s", plan_id)

    plan = read_trade_plan(plan_id)
    orders = plan.get("orders", [])
    results = []

    for order in orders:
        try:
            # TODO: implement via myalpaca_client.submit_order(order)
            logger.info("Would submit order (stub): %s", order)
            results.append({"order": order, "status": "stub", "error": None})
        except Exception as exc:
            logger.error("Order failed: %s — %s", order, exc)
            results.append({"order": order, "status": "error", "error": str(exc)})

    logger.info("Execution complete: %d/%d orders processed", len(results), len(orders))
    return results
