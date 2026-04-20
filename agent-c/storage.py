"""
agent-c/storage.py
------------------
Handles reading strategy files and writing/reading trade plan JSON files.

TODO: Implement:
      - read_latest_strategies() — scans STRATEGIES_DIR for current week's .md files
      - write_trade_plan() — persists trade plan JSON to TRADEPLANS_DIR
      - read_trade_plan() — loads an existing trade plan by ID
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import config

logger = logging.getLogger(__name__)


def get_current_week_label() -> str:
    now = datetime.now(tz=timezone.utc)
    year, week, _ = now.isocalendar()
    return f"{year}-{week:02d}"


def read_latest_strategies() -> dict[str, str]:
    """
    Scan STRATEGIES_DIR for strategy files matching the current ISO week.

    TODO: Add fallback to previous week if Monday files not yet written.

    Returns:
        dict mapping agent name → markdown content, e.g.
        {"claude": "...", "gpt": "..."}
    """
    strategies_dir = Path(config.STRATEGIES_DIR)
    week = get_current_week_label()
    results: dict[str, str] = {}

    for agent_key in ("claude", "gpt"):
        path = strategies_dir / f"strategy_{agent_key}_{week}.md"
        if path.exists():
            results[agent_key] = path.read_text(encoding="utf-8")
            logger.info("Loaded strategy: %s", path.name)
        else:
            logger.warning("Strategy file not found: %s", path)

    return results


def write_trade_plan(plan: dict) -> Path:
    """
    Persist a trade plan dict as JSON to TRADEPLANS_DIR.

    TODO: Use atomic write pattern.

    Args:
        plan: Trade plan dictionary (must include 'id' key or one is generated).

    Returns:
        Path to the written file.
    """
    tradeplans_dir = Path(config.TRADEPLANS_DIR)
    tradeplans_dir.mkdir(parents=True, exist_ok=True)

    plan_id = plan.setdefault("id", str(uuid.uuid4()))
    file_path = tradeplans_dir / f"tradeplan_{plan_id}.json"
    file_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    logger.info("Trade plan written: %s", file_path)
    return file_path


def read_trade_plan(plan_id: str) -> dict:
    """Load a trade plan JSON by its ID."""
    # TODO: Add error handling
    file_path = Path(config.TRADEPLANS_DIR) / f"tradeplan_{plan_id}.json"
    return json.loads(file_path.read_text(encoding="utf-8"))
