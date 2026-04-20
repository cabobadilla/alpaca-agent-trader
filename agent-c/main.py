"""
agent-c/main.py
---------------
Entry point for agent-c.  Schedules the daily execution job using
APScheduler (cron trigger from AGENT_C_CRON env var).
"""

import logging
import sys

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from config import config
from agent import run_execution

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("agent-c starting — cron: '%s'", config.AGENT_C_CRON)

    scheduler = BlockingScheduler(timezone=config.TZ)

    cron_parts = config.AGENT_C_CRON.strip().split()
    trigger = CronTrigger(
        minute=cron_parts[0],
        hour=cron_parts[1],
        day=cron_parts[2],
        month=cron_parts[3],
        day_of_week=cron_parts[4],
        timezone=config.TZ,
    )

    scheduler.add_job(run_execution, trigger=trigger, id="agent_c_execution")
    logger.info("Scheduler started — waiting for next trigger")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-c shutting down")


if __name__ == "__main__":
    main()
