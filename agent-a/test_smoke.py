"""
agent-a/test_smoke.py
---------------------
Smoke tests for agent-a — validate config loading, storage read/write,
section validation logic, and week-number formatting.
"""

import os
import sys

# Ensure the agent-a package directory is on the path
sys.path.insert(0, os.path.dirname(__file__))

# Set env vars BEFORE importing any modules that read them at import time
os.environ["ANTHROPIC_API_KEY"] = "test-anthropic-key"
os.environ["STRATEGIES_DIR"] = "/tmp/test_strategies"
os.environ["EVENTS_DIR"] = "/tmp/test_events_a"
os.environ["AGENT_A_CRON"] = "0 6 * * 1"
os.environ["LOG_LEVEL"] = "INFO"
os.environ["APPROVAL_BRIDGE_URL"] = "http://approval-bridge:8080"


# ---------------------------------------------------------------------------
# test_config_loads
# ---------------------------------------------------------------------------

def test_config_loads():
    """Config dataclass should read values from environment variables."""
    # Re-import to pick up the env vars set above
    import importlib
    import config as config_module
    importlib.reload(config_module)

    cfg = config_module.Config()
    assert cfg.anthropic_api_key == "test-anthropic-key", (
        f"Expected 'test-anthropic-key', got '{cfg.anthropic_api_key}'"
    )
    assert cfg.strategies_dir == "/tmp/test_strategies", (
        f"Expected '/tmp/test_strategies', got '{cfg.strategies_dir}'"
    )
    assert cfg.agent_a_cron == "0 6 * * 1", (
        f"Expected '0 6 * * 1', got '{cfg.agent_a_cron}'"
    )
    assert cfg.log_level == "INFO", (
        f"Expected 'INFO', got '{cfg.log_level}'"
    )
    assert cfg.approval_bridge_url == "http://approval-bridge:8080", (
        f"Expected 'http://approval-bridge:8080', got '{cfg.approval_bridge_url}'"
    )


# ---------------------------------------------------------------------------
# test_storage_write_read
# ---------------------------------------------------------------------------

def test_storage_write_read():
    """write_strategy() should persist content; read_strategy() should return it."""
    import shutil
    import importlib
    import storage as storage_module
    importlib.reload(storage_module)

    test_dir = "/tmp/test_strategies"
    # Clean slate
    shutil.rmtree(test_dir, ignore_errors=True)

    os.environ["STRATEGIES_DIR"] = test_dir
    importlib.reload(storage_module)

    content = "# Test Strategy\n\nThis is a test.\n"
    filename = "strategy_claude_test_2024-01.md"

    success = storage_module.write_strategy(content, filename)
    assert success is True, "write_strategy() should return True on success"

    result = storage_module.read_strategy(filename)
    assert result == content, (
        f"read_strategy() content mismatch.\nExpected: {content!r}\nGot: {result!r}"
    )

    # Cleanup
    shutil.rmtree(test_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# test_required_sections_validation
# ---------------------------------------------------------------------------

def test_required_sections_validation():
    """A report missing '## Macro Environment' should fail section validation."""
    import importlib
    import agent as agent_module
    importlib.reload(agent_module)

    # Build a string that has all required sections EXCEPT ## Macro Environment
    partial_report = "\n".join([
        "## Sector Momentum",
        "| Sector | Trend | Confidence | Notes |",
        "|--------|-------|------------|-------|",
        "## Earnings Calendar Flags",
        "| Ticker | Report Date | Consensus EPS | Risk Level |",
        "## Top 5 Ticker Recommendations",
        "| Rank | Ticker | Action | Thesis | Risk Level | Confidence |",
        "## Overall Portfolio Risk Level",
        "MEDIUM",
        "## Key Risks",
        "- Some risk",
        "## Reasoning Summary",
        "This is the summary.",
    ])

    assert "## Macro Environment" not in partial_report, "Test setup error"

    result = agent_module._validate_sections(partial_report)
    assert result is False, (
        "_validate_sections() should return False when '## Macro Environment' is missing"
    )


# ---------------------------------------------------------------------------
# test_week_format
# ---------------------------------------------------------------------------

def test_week_format():
    """Current week should be formatted as YYYY-WW with a zero-padded week number."""
    import re
    import importlib
    import agent as agent_module
    importlib.reload(agent_module)

    date_str, week_num = agent_module._get_week_info()

    # Must match YYYY-WW pattern with exactly 2 digits for week
    pattern = re.compile(r"^\d{4}-\d{2}$")
    assert pattern.match(week_num), (
        f"Week format should match YYYY-WW (zero-padded), got: '{week_num}'"
    )

    # Verify date string is also well-formed
    date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    assert date_pattern.match(date_str), (
        f"Date format should be YYYY-MM-DD, got: '{date_str}'"
    )

    # Week number must be between 01 and 53
    week_number = int(week_num.split("-")[1])
    assert 1 <= week_number <= 53, (
        f"Week number out of valid range [1, 53]: {week_number}"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    test_config_loads()
    print("  ✓ test_config_loads")

    test_storage_write_read()
    print("  ✓ test_storage_write_read")

    test_required_sections_validation()
    print("  ✓ test_required_sections_validation")

    test_week_format()
    print("  ✓ test_week_format")

    print("\nagent-a smoke tests passed ✓")
