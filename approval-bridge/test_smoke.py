"""
approval-bridge/test_smoke.py
------------------------------
Smoke tests for the approval-bridge FastAPI service.
Run with: pytest test_smoke.py
"""

import os
import sys
import uuid
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

# Set env vars before any app imports
os.environ.setdefault("RESEND_API_KEY", "test-key")
os.environ.setdefault("RESEND_FROM_EMAIL", "test@test.com")
os.environ.setdefault("RESEND_TO_EMAIL", "user@test.com")
os.environ.setdefault("TRADEPLANS_DIR", "/tmp/test_tradeplans_bridge")
os.environ.setdefault("APPROVALS_DIR", "/tmp/test_approvals_bridge")
os.environ.setdefault("LOG_LEVEL", "INFO")
os.environ.setdefault("APPROVAL_TIMEOUT_MINUTES", "120")

from unittest.mock import patch


def _make_valid_plan(date: str | None = None) -> dict:
    """Helper: build a valid TradePlanCreate payload."""
    return {
        "plan_id": str(uuid.uuid4()),
        "date": date or "2099-01-01",  # far future to avoid date conflicts
        "summary": "Test plan",
        "trades": [
            {
                "symbol": "AAPL",
                "side": "buy",
                "notional": 1000.0,
                "rationale": "Test trade",
                "risk_level": "low",
                "source_agreement": "BOTH",
            }
        ],
        "total_notional": 1000.0,
        "risk_summary": "Low risk",
        "agent_reasoning": "Both agents agree on this trade.",
        "strategy_agreement_score": 0.85,
        "key_disagreements": [],
        "portfolio_snapshot": {"equity": 50000.0, "cash": 10000.0, "buying_power": 20000.0},
    }


def _clean_approvals_dir() -> None:
    """Remove and recreate the test approvals directory for a clean slate."""
    approvals_dir = os.environ.get("APPROVALS_DIR", "/tmp/test_approvals_bridge")
    shutil.rmtree(approvals_dir, ignore_errors=True)
    os.makedirs(approvals_dir, exist_ok=True)


def test_health():
    """GET /health returns 200 {status: ok}"""
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_submit_plan_returns_201():
    """POST /plans with valid TradePlanCreate body returns 201 (email mocked)."""
    # Clean slate — remove any leftover approval files from prior runs
    _clean_approvals_dir()

    import importlib
    import services.approval_state as state_module
    importlib.reload(state_module)

    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    plan = _make_valid_plan()

    with patch("routers.approval.email_service.send_plan_notification", return_value=True):
        response = client.post("/plans", json=plan)

    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
    body = response.json()
    assert body["plan_id"] == plan["plan_id"]
    assert "expires_at" in body
    assert "message" in body


def test_get_status_returns_404_for_unknown():
    """GET /plans/unknown-id/status returns 404."""
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    response = client.get("/plans/totally-unknown-plan-id-xyz/status")
    assert response.status_code == 404


if __name__ == "__main__":
    test_health()
    print("✓ test_health passed")
    test_submit_plan_returns_201()
    print("✓ test_submit_plan_returns_201 passed")
    test_get_status_returns_404_for_unknown()
    print("✓ test_get_status_returns_404_for_unknown passed")
    print("\n✅ All approval-bridge smoke tests passed")
