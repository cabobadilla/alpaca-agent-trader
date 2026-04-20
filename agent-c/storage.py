"""
agent-c/storage.py
------------------
Handles reading strategy files and writing trade plan JSON files.
"""

import json
import logging
import os
from datetime import date, datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _strategies_dir() -> Path:
    return Path(os.getenv("STRATEGIES_DIR", "/data/strategies"))


def _tradeplans_dir() -> Path:
    return Path(os.getenv("TRADEPLANS_DIR", "/data/tradeplans"))


def _current_week_label() -> str:
    """Return ISO week label for today, e.g. '2025-17'."""
    now = datetime.now(tz=timezone.utc)
    year, week, _ = now.isocalendar()
    return f"{year}-{week:02d}"


def read_latest_strategy(prefix: str) -> str | None:
    """
    Find the most recent strategy file matching STRATEGIES_DIR/strategy_{prefix}_*.md
    by modification time.

    Args:
        prefix: 'claude' or 'gpt'

    Returns:
        File content as string, or None if no matching file found.
    """
    strategies_dir = _strategies_dir()
    if not strategies_dir.exists():
        logger.warning("Strategies directory does not exist: %s", strategies_dir)
        return None

    candidates = list(strategies_dir.glob(f"strategy_{prefix}_*.md"))
    if not candidates:
        logger.warning("No strategy files found for prefix '%s' in %s", prefix, strategies_dir)
        return None

    # Sort by modification time, newest first
    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    logger.info("Reading strategy file: %s", latest.name)
    return latest.read_text(encoding="utf-8")


def write_tradeplan(plan: dict) -> bool:
    """
    Write a trade plan dict as JSON to TRADEPLANS_DIR/tradeplan_{YYYY-MM-DD}.json.

    Returns:
        True on success, False on failure.
    """
    tradeplans_dir = _tradeplans_dir()
    try:
        tradeplans_dir.mkdir(parents=True, exist_ok=True)
        today = date.today().strftime("%Y-%m-%d")
        file_path = tradeplans_dir / f"tradeplan_{today}.json"
        file_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")
        logger.info("Trade plan written: %s", file_path)
        return True
    except Exception as exc:
        logger.error("Failed to write trade plan: %s", exc)
        return False


def strategies_ready_for_today() -> bool:
    """
    Check whether both strategy_claude_YYYY-WW.md and strategy_gpt_YYYY-WW.md
    exist in STRATEGIES_DIR AND were last modified today (local date).

    Returns:
        True only if both files exist and are dated today.
    """
    strategies_dir = _strategies_dir()
    week = _current_week_label()
    today_date = date.today()

    for prefix in ("claude", "gpt"):
        path = strategies_dir / f"strategy_{prefix}_{week}.md"
        if not path.exists():
            logger.debug("Strategy not ready: %s", path.name)
            return False
        mtime = datetime.fromtimestamp(path.stat().st_mtime).date()
        if mtime != today_date:
            logger.debug(
                "Strategy exists but stale (mtime %s, today %s): %s",
                mtime,
                today_date,
                path.name,
            )
            return False

    logger.info("Both strategy files ready for week %s", week)
    return True
