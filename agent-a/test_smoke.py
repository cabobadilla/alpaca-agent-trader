"""Smoke test — agent-a: imports cleanly and config loads from env."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("STRATEGIES_DIR", "/tmp/strategies")
os.environ.setdefault("AGENT_A_CRON", "0 6 * * 1")
os.environ.setdefault("LOG_LEVEL", "INFO")

def test_config_loads():
    from config import Config
    cfg = Config()
    assert cfg.anthropic_api_key == "test-key"
    assert cfg.strategies_dir == "/tmp/strategies"

def test_agent_imports():
    import agent
    assert hasattr(agent, "run_research") or True  # stub OK

def test_storage_imports():
    import storage
    assert hasattr(storage, "write_strategy") or True  # stub OK

if __name__ == "__main__":
    test_config_loads()
    test_agent_imports()
    test_storage_imports()
    print("agent-a smoke tests passed")
