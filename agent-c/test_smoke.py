"""
agent-c/test_smoke.py
---------------------
Smoke tests for agent-c modules.
Run with: pytest test_smoke.py
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

# Set env vars before imports
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("STRATEGIES_DIR", "/tmp/test-strategies")
os.environ.setdefault("TRADEPLANS_DIR", "/tmp/test-tradeplans")
os.environ.setdefault("MYALPACA_BASE_URL", "http://localhost:3001")
os.environ.setdefault("APPROVAL_BRIDGE_URL", "http://localhost:8080")
os.environ.setdefault("AGENT_C_CRON", "0 9 * * 1-5")
os.environ.setdefault("APPROVAL_TIMEOUT_MINUTES", "120")
os.environ.setdefault("LOG_LEVEL", "INFO")
os.environ["EVENTS_DIR"] = "/tmp/test_events_c"


def test_config_loads():
    """Config dataclass loads without raising."""
    from config import Config

    cfg = Config()
    assert cfg.ANTHROPIC_API_KEY == "test-key"
    assert cfg.STRATEGIES_DIR == "/tmp/test-strategies"
    assert cfg.TRADEPLANS_DIR == "/tmp/test-tradeplans"
    assert cfg.MYALPACA_BASE_URL == "http://localhost:3001"
    assert cfg.APPROVAL_BRIDGE_URL == "http://localhost:8080"
    assert cfg.AGENT_C_CRON == "0 9 * * 1-5"
    assert cfg.APPROVAL_TIMEOUT_MINUTES == 120
    assert cfg.LOG_LEVEL == "INFO"


def test_myalpaca_client_instantiates():
    """MyAlpacaClient can be instantiated with a custom base_url."""
    from myalpaca_client import MyAlpacaClient

    client = MyAlpacaClient(base_url="http://test-host:3001")
    assert client.base_url == "http://test-host:3001"


def test_approval_client_instantiates():
    """ApprovalBridgeClient can be instantiated with a custom base_url."""
    from approval_client import ApprovalBridgeClient

    client = ApprovalBridgeClient(base_url="http://test-bridge:8080")
    assert client.base_url == "http://test-bridge:8080"


def test_strategies_dir_check_returns_false_when_empty():
    """strategies_ready_for_today() returns False when STRATEGIES_DIR is empty."""
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["STRATEGIES_DIR"] = tmpdir
        # Must re-import to pick up new env var (storage reads via os.getenv)
        import importlib
        import storage
        importlib.reload(storage)
        result = storage.strategies_ready_for_today()
        assert result is False, "Expected False when no strategy files exist"


if __name__ == "__main__":
    test_config_loads()
    print("✓ test_config_loads passed")
    test_myalpaca_client_instantiates()
    print("✓ test_myalpaca_client_instantiates passed")
    test_approval_client_instantiates()
    print("✓ test_approval_client_instantiates passed")
    test_strategies_dir_check_returns_false_when_empty()
    print("✓ test_strategies_dir_check_returns_false_when_empty passed")
    print("\n✅ All agent-c smoke tests passed")
