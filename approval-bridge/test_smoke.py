"""Smoke test — approval-bridge: FastAPI app starts and /health returns 200."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

os.environ.setdefault("RESEND_API_KEY", "test-key")
os.environ.setdefault("RESEND_FROM_EMAIL", "test@test.com")
os.environ.setdefault("RESEND_TO_EMAIL", "user@test.com")
os.environ.setdefault("TRADEPLANS_DIR", "/tmp/tradeplans")
os.environ.setdefault("APPROVALS_DIR", "/tmp/approvals")
os.environ.setdefault("LOG_LEVEL", "INFO")

def test_health_endpoint():
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

if __name__ == "__main__":
    test_health_endpoint()
    print("approval-bridge smoke tests passed")
