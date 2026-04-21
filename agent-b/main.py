"""
agent-b/main.py
---------------
Entry point for agent-b.  Schedules the weekly GPT-4o-mini research job
using APScheduler (cron trigger from AGENT_B_CRON env var).

Features:
  - Logs cron schedule and next fire time on startup
  - Background heartbeat thread writes /tmp/agent-b.heartbeat every 30 seconds
  - Runs BlockingScheduler (blocks main thread)
"""

import logging
import sys
import threading
import time
from pathlib import Path

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from config import config
from agent import run_research_with_retry  # noqa: F401 — kept for direct import compatibility
from server import start as _start_flask, trigger_run as _scheduled_run

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

HEARTBEAT_PATH = Path("/tmp/agent-b.heartbeat")
HEARTBEAT_INTERVAL = 30  # seconds


def _heartbeat_loop() -> None:
    """Background thread: writes a timestamp to the heartbeat file every 30 seconds."""
    while True:
        try:
            HEARTBEAT_PATH.write_text(str(time.time()), encoding="utf-8")
        except Exception as exc:
            logger.warning("Failed to write heartbeat: %s", exc)
        time.sleep(HEARTBEAT_INTERVAL)


def _start_heartbeat() -> threading.Thread:
    """Start the heartbeat background thread (daemon so it exits with the process)."""
    thread = threading.Thread(target=_heartbeat_loop, name="heartbeat", daemon=True)
    thread.start()
    logger.info("Heartbeat thread started — writing to %s every %ds", HEARTBEAT_PATH, HEARTBEAT_INTERVAL)
    return thread


def _build_trigger() -> CronTrigger:
    """Parse AGENT_B_CRON (5-field standard cron) into a CronTrigger."""
    cron_parts = config.AGENT_B_CRON.strip().split()
    if len(cron_parts) != 5:
        raise ValueError(
            f"AGENT_B_CRON must be a 5-field cron expression, got: '{config.AGENT_B_CRON}'"
        )
    return CronTrigger(
        minute=cron_parts[0],
        hour=cron_parts[1],
        day=cron_parts[2],
        month=cron_parts[3],
        day_of_week=cron_parts[4],
        timezone=config.TZ,
    )


def main() -> None:
    logger.info("agent-b starting — cron: '%s'", config.AGENT_B_CRON)

    scheduler = BlockingScheduler(timezone=config.TZ)
    trigger = _build_trigger()

    job = scheduler.add_job(
        _scheduled_run,
        trigger=trigger,
        id="agent_b_research",
        name="Agent B Weekly Research",
    )

    # Log next fire time before blocking
    next_run = job.next_run_time
    logger.info(
        "agent-b scheduled — next fire time: %s (cron: '%s')",
        next_run,
        config.AGENT_B_CRON,
    )

    _start_heartbeat()
    _start_flask(port=5002)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-b shutting down")


if __name__ == "__main__":
    main()
