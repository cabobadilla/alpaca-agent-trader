"""
agent-a/main.py
---------------
Entry point for agent-a.  Schedules the weekly Claude Sonnet research job
using APScheduler (cron trigger from AGENT_A_CRON env var).
"""

import logging
import sys
import time

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from config import config
from agent import run_research

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("agent-a starting — cron: '%s'", config.AGENT_A_CRON)

    scheduler = BlockingScheduler(timezone=config.TZ)

    # Parse the cron string (5-field standard cron)
    cron_parts = config.AGENT_A_CRON.strip().split()
    trigger = CronTrigger(
        minute=cron_parts[0],
        hour=cron_parts[1],
        day=cron_parts[2],
        month=cron_parts[3],
        day_of_week=cron_parts[4],
        timezone=config.TZ,
    )

    scheduler.add_job(run_research, trigger=trigger, id="agent_a_research")
    logger.info("Scheduler started — waiting for next trigger")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-a shutting down")


if __name__ == "__main__":
    main()
