"""
agent-a/main.py
---------------
Entry point for agent-a.  Schedules the weekly Claude Sonnet research job
using APScheduler (cron trigger from AGENT_A_CRON env var).

Features:
  - Logs cron schedule and next fire time on startup
  - Background heartbeat thread writes /tmp/agent-a.heartbeat every 30 seconds
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
from agent import run_research_with_retry

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

HEARTBEAT_PATH = Path("/tmp/agent-a.heartbeat")
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
    """Parse AGENT_A_CRON (5-field standard cron) into a CronTrigger."""
    cron_parts = config.AGENT_A_CRON.strip().split()
    if len(cron_parts) != 5:
        raise ValueError(
            f"AGENT_A_CRON must be a 5-field cron expression, got: '{config.AGENT_A_CRON}'"
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
    logger.info("agent-a starting — cron: '%s'", config.AGENT_A_CRON)

    scheduler = BlockingScheduler(timezone=config.TZ)
    trigger = _build_trigger()

    job = scheduler.add_job(
        run_research_with_retry,
        trigger=trigger,
        id="agent_a_research",
        name="Agent A Weekly Research",
    )

    # Log next fire time before blocking
    next_run = job.next_run_time
    logger.info(
        "agent-a scheduled — next fire time: %s (cron: '%s')",
        next_run,
        config.AGENT_A_CRON,
    )

    _start_heartbeat()

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-a shutting down")


if __name__ == "__main__":
    main()
