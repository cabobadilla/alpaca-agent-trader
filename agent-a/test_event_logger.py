import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("STRATEGIES_DIR", "/tmp/test_strategies")


def _make_logger(tmp_dir):
    from event_logger import EventLogger
    return EventLogger(agent="test-agent", events_dir=tmp_dir)


def test_phase_creates_event_file():
    with tempfile.TemporaryDirectory() as tmp:
        el = _make_logger(tmp)
        el._phase_file = el._phase_file.parent / "test-agent-test.phase"
        el.phase("researching", message="starting")
        files = [f for f in os.listdir(tmp) if f.endswith(".json")]
        assert len(files) == 1, f"Expected 1 file, got {len(files)}"
        data = json.loads(open(os.path.join(tmp, files[0])).read())
        assert data["event_type"] == "agent_phase"
        assert data["phase"] == "researching"
        assert data["agent"] == "test-agent"
        assert data["level"] == "INFO"
        assert "id" in data and "timestamp" in data
    print("  ✓ test_phase_creates_event_file")


def test_error_creates_error_event():
    with tempfile.TemporaryDirectory() as tmp:
        el = _make_logger(tmp)
        el._phase_file = el._phase_file.parent / "test-agent-err.phase"
        el.error("network failure", metadata={"detail": "timeout"})
        files = [f for f in os.listdir(tmp) if f.endswith(".json")]
        assert len(files) == 1
        data = json.loads(open(os.path.join(tmp, files[0])).read())
        assert data["event_type"] == "agent_error"
        assert data["level"] == "ERROR"
        assert data["metadata"]["detail"] == "timeout"
    print("  ✓ test_error_creates_error_event")


def test_event_sets_plan_id():
    with tempfile.TemporaryDirectory() as tmp:
        el = _make_logger(tmp)
        el.event("trade_executed", plan_id="abc-123", message="MSFT buy")
        files = [f for f in os.listdir(tmp) if f.endswith(".json")]
        data = json.loads(open(os.path.join(tmp, files[0])).read())
        assert data["plan_id"] == "abc-123"
        assert data["event_type"] == "trade_executed"
    print("  ✓ test_event_sets_plan_id")


def test_phase_writes_phase_file():
    with tempfile.TemporaryDirectory() as tmp:
        el = _make_logger(tmp)
        phase_path = el._phase_file.parent / "test-agent-phase.phase"
        el._phase_file = phase_path
        el.phase("awaiting_approval", plan_id="xyz")
        assert phase_path.exists(), "Phase file not written"
        data = json.loads(phase_path.read_text())
        assert data["phase"] == "awaiting_approval"
        assert data["plan_id"] == "xyz"
        phase_path.unlink(missing_ok=True)
    print("  ✓ test_phase_writes_phase_file")


def test_error_sets_phase_to_error():
    with tempfile.TemporaryDirectory() as tmp:
        el = _make_logger(tmp)
        phase_path = el._phase_file.parent / "test-agent-errphase.phase"
        el._phase_file = phase_path
        el.error("api call failed")
        data = json.loads(phase_path.read_text())
        assert data["phase"] == "error"
        assert data["error_message"] == "api call failed"
        phase_path.unlink(missing_ok=True)
    print("  ✓ test_error_sets_phase_to_error")


def test_never_raises_on_bad_dir():
    from event_logger import EventLogger
    el = EventLogger(agent="x", events_dir="/nonexistent/readonly/path/abc")
    el.phase("idle")   # must not raise
    el.error("oops")   # must not raise
    el.event("trade_executed")  # must not raise
    print("  ✓ test_never_raises_on_bad_dir")


if __name__ == "__main__":
    test_phase_creates_event_file()
    test_error_creates_error_event()
    test_event_sets_plan_id()
    test_phase_writes_phase_file()
    test_error_sets_phase_to_error()
    test_never_raises_on_bad_dir()
    print("\nevent_logger tests passed ✓")
