"""
agent-a/storage.py
------------------
Handles reading and writing strategy markdown files to the shared volume.

TODO: Implement write_strategy() to persist Claude's output as
      strategy_claude_YYYY-WW.md in STRATEGIES_DIR.
"""

import os
import logging
from datetime import datetime, timezone
from pathlib import Path

from config import config

logger = logging.getLogger(__name__)


def get_strategy_filename() -> str:
    """Return the canonical filename for this week's Claude strategy."""
    now = datetime.now(tz=timezone.utc)
    year, week, _ = now.isocalendar()
    return f"strategy_claude_{year}-{week:02d}.md"


def write_strategy(content: str) -> Path:
    """
    Persist strategy markdown content to the strategies volume.

    TODO: Add retry logic and atomic write (write-then-rename).

    Args:
        content: Markdown string produced by agent.

    Returns:
        Path to the written file.
    """
    strategies_dir = Path(config.STRATEGIES_DIR)
    strategies_dir.mkdir(parents=True, exist_ok=True)

    filename = get_strategy_filename()
    file_path = strategies_dir / filename

    # TODO: implement atomic write
    file_path.write_text(content, encoding="utf-8")
    logger.info("Strategy written to %s", file_path)
    return file_path


def read_strategy(file_path: Path) -> str:
    """Read and return the content of a strategy file."""
    # TODO: Add error handling for missing files
    return file_path.read_text(encoding="utf-8")
