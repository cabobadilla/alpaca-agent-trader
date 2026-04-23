"""
agent-c/main.py
---------------
Entry point for agent-c. Schedules the daily execution job using APScheduler.
Writes a heartbeat file every 30 seconds so orchestration can confirm liveness.
"""

import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from config import config
from agent import build_trade_plan
from approval_client import ApprovalBridgeClient
from executor import execute_plan
from myalpaca_client import MyAlpacaClient
from storage import read_latest_strategy, strategies_ready_for_today, write_tradeplan
from server import start as _start_flask
from event_logger import EventLogger

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

_elog = EventLogger(agent="agent-c")

HEARTBEAT_PATH = Path("/tmp/agent-c.heartbeat")
STRATEGY_WAIT_MAX_MINUTES = 120
STRATEGY_POLL_MINUTES = 15


async def run_daily() -> None:
    """
    Full daily execution workflow for agent-c.

    Steps:
        1. health_check myalpaca — abort if down
        2. strategies_ready_for_today() — wait up to 2h, abort with alert if not ready
        3. fetch portfolio (account + positions + orders)
        4. read both strategy files
        5. build_trade_plan() — abort on None
        6. write_tradeplan()
        7. submit_plan() to bridge
        8. poll_until_decided()
        9. if APPROVED: execute_plan()
        10. if REJECTED/EXPIRED/TIMEOUT: log + send notification, exit
    """
    alpaca = MyAlpacaClient(base_url=config.MYALPACA_BASE_URL)
    bridge = ApprovalBridgeClient(base_url=config.APPROVAL_BRIDGE_URL)

    logger.info("agent-c: starting daily execution run")
    _elog.phase("idle", message="Daily run started")

    # ── Step 1: health check ──────────────────────────────────────────────────
    if not alpaca.health_check():
        msg = "myAlpaca service is unreachable — aborting daily run"
        logger.error(msg)
        _elog.error(msg)
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: myAlpaca unreachable",
            html=f"<p>{msg}</p>",
        )
        return

    # ── Step 2: wait for strategies ───────────────────────────────────────────
    _elog.phase("waiting_strategies", message="Polling for strategy files")
    waited_minutes = 0
    while not strategies_ready_for_today():
        if waited_minutes >= STRATEGY_WAIT_MAX_MINUTES:
            msg = f"Strategy files not ready after {STRATEGY_WAIT_MAX_MINUTES}min — aborting"
            logger.error(msg)
            _elog.error(msg)
            bridge.send_notification(
                plan_id="N/A",
                ntype="ALERT",
                subject="[agent-c] ABORT: Strategy files not ready",
                html=f"<p>{msg}</p>",
            )
            return
        logger.info(
            "Strategies not ready yet, waiting %d min… (%d/%d min elapsed)",
            STRATEGY_POLL_MINUTES,
            waited_minutes,
            STRATEGY_WAIT_MAX_MINUTES,
        )
        await asyncio.sleep(STRATEGY_POLL_MINUTES * 60)
        waited_minutes += STRATEGY_POLL_MINUTES

    # ── Step 3: fetch portfolio ───────────────────────────────────────────────
    _elog.phase("building_plan", message="Fetching portfolio")
    try:
        account = alpaca.get_account()
        positions = alpaca.get_positions()
        orders = alpaca.get_orders()
        logger.info(
            "Portfolio fetched: equity=%s, cash=%s",
            account.get("equity"),
            account.get("cash"),
        )
    except Exception as exc:
        msg = f"Failed to fetch portfolio: {exc}"
        logger.error(msg)
        _elog.error(msg, metadata={"exc": str(exc)})
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: Portfolio fetch failed",
            html=f"<p>Failed to fetch portfolio from myAlpaca: {exc}</p>",
        )
        return

    # ── Step 4: read strategy files ───────────────────────────────────────────
    claude_strategy = read_latest_strategy("claude")
    gpt_strategy = read_latest_strategy("gpt")

    if not claude_strategy or not gpt_strategy:
        msg = "Could not read one or both strategy files — aborting"
        logger.error(msg)
        _elog.error(msg)
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: Strategy file read failed",
            html="<p>Could not read claude or gpt strategy file.</p>",
        )
        return

    # ── Step 5: build trade plan ──────────────────────────────────────────────
    _elog.phase("building_plan", message="Generating trade plan with Claude")
    plan = build_trade_plan(
        claude_strategy=claude_strategy,
        gpt_strategy=gpt_strategy,
        account=account,
        positions=positions,
        orders=orders,
    )
    if plan is None:
        msg = "build_trade_plan() returned None — aborting"
        logger.error(msg)
        _elog.error(msg)
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: Trade plan generation failed",
            html="<p>Claude returned an invalid or unparseable trade plan.</p>",
        )
        return

    plan_id = plan.get("plan_id", "unknown")
    logger.info("Trade plan generated: %s (%d trades)", plan_id, len(plan.get("trades", [])))

    # ── Step 6: persist trade plan ────────────────────────────────────────────
    write_tradeplan(plan)

    # ── Step 7: submit to approval bridge ────────────────────────────────────
    try:
        submission_result = bridge.submit_plan(plan)
        logger.info("Plan submitted: %s", submission_result)
        _elog.event("plan_submitted", plan_id=plan_id, message="Trade plan submitted to approval bridge")
    except Exception as exc:
        msg = f"Failed to submit plan to approval-bridge: {exc}"
        logger.error(msg)
        _elog.error(msg, plan_id=plan_id)
        bridge.send_notification(
            plan_id=plan_id,
            ntype="ALERT",
            subject=f"[agent-c] ABORT: Bridge submission failed — {plan_id}",
            html=f"<p>Failed to submit plan {plan_id} to approval-bridge: {exc}</p>",
        )
        return

    # ── Step 8: poll for decision ─────────────────────────────────────────────
    _elog.phase(
        "awaiting_approval",
        plan_id=plan_id,
        message=f"Waiting for human decision on plan {plan_id}",
    )
    decision = bridge.poll_until_decided(
        plan_id=plan_id,
        timeout_minutes=config.APPROVAL_TIMEOUT_MINUTES,
        interval_seconds=120,
    )
    logger.info("Plan %s decision: %s", plan_id, decision)
    _elog.event(
        "plan_decision",
        level="INFO" if decision == "APPROVED" else "WARN",
        plan_id=plan_id,
        message=f"Plan decision: {decision}",
    )

    # ── Step 9/10: act on decision ────────────────────────────────────────────
    if decision == "APPROVED":
        _elog.phase("executing", plan_id=plan_id, message="Executing approved trades")
        logger.info("Plan APPROVED — executing trades")
        result = execute_plan(plan=plan, alpaca=alpaca, bridge=bridge, elog=_elog)
        logger.info(
            "Execution complete: %d executed, %d failed",
            result["executed"],
            result["failed"],
        )
        _elog.phase(
            "complete",
            plan_id=plan_id,
            message=f"Execution complete: {result['executed']} executed, {result['failed']} failed",
        )
    else:
        msg = f"Plan {plan_id} not executed — decision={decision}"
        logger.warning(msg)
        _elog.phase("complete", plan_id=plan_id, message=msg)
        bridge.send_notification(
            plan_id=plan_id,
            ntype="ALERT",
            subject=f"[agent-c] Trade plan {decision} — {plan_id}",
            html=f"<p>{msg}</p><p>No trades were submitted.</p>",
        )

    logger.info("agent-c: daily execution run complete")


def _run_daily_sync() -> None:
    """Synchronous wrapper to run the async run_daily() from APScheduler."""
    asyncio.run(run_daily())


def _write_heartbeat() -> None:
    """Write current timestamp to heartbeat file."""
    try:
        HEARTBEAT_PATH.write_text(datetime.now(tz=timezone.utc).isoformat(), encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to write heartbeat: %s", exc)


def main() -> None:
    logger.info("agent-c starting — cron: '%s'", config.AGENT_C_CRON)

    scheduler = BackgroundScheduler(timezone=config.TZ)

    # Daily execution job
    cron_parts = config.AGENT_C_CRON.strip().split()
    trigger = CronTrigger(
        minute=cron_parts[0],
        hour=cron_parts[1],
        day=cron_parts[2],
        month=cron_parts[3],
        day_of_week=cron_parts[4],
        timezone=config.TZ,
    )
    scheduler.add_job(_run_daily_sync, trigger=trigger, id="agent_c_execution")

    # Heartbeat job (every 30 seconds)
    scheduler.add_job(
        _write_heartbeat,
        "interval",
        seconds=30,
        id="agent_c_heartbeat",
    )

    scheduler.start()
    logger.info("Scheduler started — waiting for next trigger")
    _start_flask(port=5003)
    _elog.phase("idle", message="agent-c started, waiting for scheduled run")

    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-c shutting down")
        scheduler.shutdown()


if __name__ == "__main__":
    main()
