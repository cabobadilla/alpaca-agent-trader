"""
agent-a/storage.py
------------------
Handles reading and writing strategy markdown files to the shared volume.

Public API:
    write_strategy(content, filename) -> bool
    read_strategy(filename) -> str | None
    list_strategies() -> list[str]
"""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_STRATEGIES_DIR = "/data/strategies"


def _get_strategies_dir() -> Path:
    """Return the strategies directory path from env, creating it if needed."""
    strategies_dir = os.environ.get("STRATEGIES_DIR", _DEFAULT_STRATEGIES_DIR)
    return Path(strategies_dir)


def write_strategy(content: str, filename: str) -> bool:
    """
    Persist strategy markdown content to the strategies volume.

    Uses an atomic write-then-rename pattern to avoid partial reads.

    Args:
        content:  Markdown string produced by the agent.
        filename: Target filename (e.g. 'strategy_claude_2024-17.md').

    Returns:
        True on success, False on any error.
    """
    try:
        strategies_dir = _get_strategies_dir()
        strategies_dir.mkdir(parents=True, exist_ok=True)

        target_path = strategies_dir / filename
        # Atomic write: write to a temp file, then rename
        tmp_path = target_path.with_suffix(".tmp")
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.rename(target_path)

        logger.info("Strategy written to %s", target_path)
        return True
    except Exception as exc:
        logger.error("Failed to write strategy '%s': %s", filename, exc, exc_info=True)
        return False


def read_strategy(filename: str) -> str | None:
    """
    Read and return the content of a strategy file.

    Args:
        filename: The filename (not full path) of the strategy to read.

    Returns:
        File content as a string, or None if the file does not exist / cannot be read.
    """
    try:
        strategies_dir = _get_strategies_dir()
        file_path = strategies_dir / filename
        if not file_path.is_file():
            logger.warning("Strategy file not found: %s", file_path)
            return None
        content = file_path.read_text(encoding="utf-8")
        logger.debug("Strategy read from %s", file_path)
        return content
    except Exception as exc:
        logger.error("Failed to read strategy '%s': %s", filename, exc, exc_info=True)
        return None


def list_strategies() -> list[str]:
    """
    Return a sorted list of all strategy filenames in STRATEGIES_DIR.

    Returns:
        List of filename strings (not full paths), sorted alphabetically.
        Returns an empty list if the directory does not exist or is empty.
    """
    try:
        strategies_dir = _get_strategies_dir()
        if not strategies_dir.is_dir():
            return []
        filenames = sorted(p.name for p in strategies_dir.iterdir() if p.is_file())
        return filenames
    except Exception as exc:
        logger.error("Failed to list strategies: %s", exc, exc_info=True)
        return []
