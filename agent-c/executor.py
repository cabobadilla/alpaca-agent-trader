"""
agent-c/executor.py
-------------------
Executes approved trade plans via myAlpaca and notifies via approval-bridge.
"""

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from event_logger import EventLogger

from approval_client import ApprovalBridgeClient
from myalpaca_client import MyAlpacaClient

logger = logging.getLogger(__name__)


def execute_plan(
    plan: dict,
    alpaca: MyAlpacaClient,
    bridge: ApprovalBridgeClient,
    elog: "EventLogger | None" = None,
) -> dict:
    """
    Execute all trades in an approved plan.

    For each trade: calls alpaca.execute_trade(). On failure, logs the error
    and continues (no abort). After all trades, sends a notification via bridge.

    Args:
        plan:   Trade plan dict (must have 'trades' and 'plan_id' keys).
        alpaca: MyAlpacaClient instance.
        bridge: ApprovalBridgeClient instance.
        elog:   Optional EventLogger for structured trade events.

    Returns:
        {executed: int, failed: int, log: list[dict]}
    """
    plan_id = plan.get("plan_id", "unknown")
    trades = plan.get("trades", [])
    executed = 0
    failed = 0
    execution_log: list[dict] = []

    logger.info(
        "Executing approved plan %s: %d trades", plan_id, len(trades)
    )

    for trade in trades:
        symbol = trade.get("symbol", "")
        side = trade.get("side", "")
        notional = float(trade.get("notional", 0.0))

        entry = {"symbol": symbol, "side": side, "notional": notional}

        try:
            result = alpaca.execute_trade(symbol=symbol, side=side, notional=notional)
            entry["status"] = "executed"
            entry["result"] = result
            executed += 1
            logger.info("Trade executed: %s %s $%.2f → %s", side, symbol, notional, result)
            if elog:
                elog.event(
                    "trade_executed",
                    plan_id=plan_id,
                    message=f"{side.upper()} {symbol} ${notional:.2f}",
                    metadata={"symbol": symbol, "side": side, "notional": notional},
                )
        except Exception as exc:
            entry["status"] = "failed"
            entry["error"] = str(exc)
            failed += 1
            logger.error(
                "Trade failed: %s %s $%.2f — %s", side, symbol, notional, exc
            )
            if elog:
                elog.event(
                    "trade_failed",
                    level="ERROR",
                    plan_id=plan_id,
                    message=f"{side.upper()} {symbol} ${notional:.2f} — {exc}",
                    metadata={"symbol": symbol, "side": side, "notional": notional, "error": str(exc)},
                )

        execution_log.append(entry)

    logger.info(
        "Execution complete for plan %s: %d executed, %d failed",
        plan_id,
        executed,
        failed,
    )

    # Send execution confirmation via bridge
    try:
        rows = "".join(
            f"<tr><td><b>{e['symbol']}</b></td><td>{e['side'].upper()}</td>"
            f"<td>${e['notional']:.2f}</td><td>{e['status'].upper()}</td></tr>"
            for e in execution_log
        )
        html = f"""
        <html><body>
        <h2>Trade Execution Summary — Plan {plan_id}</h2>
        <p>Executed: <b>{executed}</b> | Failed: <b>{failed}</b> | Total: <b>{len(trades)}</b></p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr><th>Symbol</th><th>Side</th><th>Notional</th><th>Status</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        </body></html>
        """
        bridge.send_notification(
            plan_id=plan_id,
            ntype="EXECUTION_SUMMARY",
            subject=f"Execution Complete — Plan {plan_id} ({executed}/{len(trades)} trades)",
            html=html,
        )
    except Exception as exc:
        logger.warning("Failed to send execution notification: %s", exc)

    return {"executed": executed, "failed": failed, "log": execution_log}
