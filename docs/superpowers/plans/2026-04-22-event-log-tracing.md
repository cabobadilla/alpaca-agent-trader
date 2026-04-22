# Event Log, Tracing & Error Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent event logging, live agent phase tracking, visible error surfaces, and a Logs page — plus fix the missing APPROVE button on the Approvals page.

**Architecture:** A shared `EventLogger` Python class (copied into each agent directory) writes structured JSON events to a new `/data/events/` Docker volume. Each agent's Flask `/status` endpoint is extended to expose the current phase and last error. The Node.js backend serves events via REST + SSE, and a new React Logs page consumes them.

**Tech Stack:** Python 3.12, Flask, APScheduler, Node.js/Express (TypeScript), React + Tailwind, Docker Compose

---

## File Map

| File | Action |
|------|--------|
| `agent-a/event_logger.py` | Create — EventLogger class |
| `agent-b/event_logger.py` | Create — identical copy |
| `agent-c/event_logger.py` | Create — identical copy |
| `agent-a/test_event_logger.py` | Create — tests |
| `agent-a/agent.py` | Modify — add phase/error events |
| `agent-a/main.py` | Modify — emit idle phase on start |
| `agent-a/server.py` | Modify — return phase in /status |
| `agent-b/agent.py` | Modify — add phase/error events |
| `agent-b/main.py` | Modify — emit idle phase on start |
| `agent-b/server.py` | Modify — return phase in /status |
| `agent-c/main.py` | Modify — add phase events at all steps |
| `agent-c/executor.py` | Modify — add trade_executed/trade_failed events |
| `agent-c/server.py` | Modify — return phase in /status |
| `docker-compose.yml` | Modify — add events-data volume |
| `myalpaca/backend/src/routes/events.ts` | Create — GET /api/events + SSE stream |
| `myalpaca/backend/src/routes/agents.ts` | Modify — forward phase + last_error |
| `myalpaca/backend/src/routes/approvals.ts` | Modify — add GET /all |
| `myalpaca/backend/src/index.ts` | Modify — register events route |
| `myalpaca/frontend/src/pages/Approvals.tsx` | Modify — fix APPROVE bug, error banner, retry |
| `myalpaca/frontend/src/pages/Agents.tsx` | Modify — phase display, error banner |
| `myalpaca/frontend/src/pages/Logs.tsx` | Create — audit log page |
| `myalpaca/frontend/src/App.tsx` | Modify — add Logs route + nav link |

---

## Task 1: EventLogger class

**Files:**
- Create: `agent-a/event_logger.py`
- Create: `agent-a/test_event_logger.py`

- [ ] **Step 1: Write the test file**

```python
# agent-a/test_event_logger.py
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
```

- [ ] **Step 2: Run tests — verify they FAIL with ImportError**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-a
python test_event_logger.py
```

Expected: `ModuleNotFoundError: No module named 'event_logger'`

- [ ] **Step 3: Create `agent-a/event_logger.py`**

```python
"""
event_logger.py
---------------
Structured event logger for all agents.
Writes JSON events to /data/events/ and maintains a phase file at /tmp/{agent}.phase.
Never raises — all I/O errors are swallowed and logged to stdout only.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class EventLogger:
    def __init__(self, agent: str, events_dir: str = "/data/events") -> None:
        self.agent = agent
        self.events_dir = Path(events_dir)
        self._phase_file = Path(f"/tmp/{agent}.phase")
        try:
            self.events_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            logger.warning("EventLogger: cannot create events dir %s: %s", events_dir, exc)

    def _now(self) -> str:
        return datetime.now(tz=timezone.utc).isoformat()

    def _write(self, event: dict) -> None:
        try:
            ts = event["timestamp"].replace(":", "-").replace("+", "p").replace(".", "-")
            short_id = event["id"][:8]
            filename = f"{ts}_{self.agent}_{event['event_type']}_{short_id}.json"
            (self.events_dir / filename).write_text(
                json.dumps(event), encoding="utf-8"
            )
        except Exception as exc:
            logger.warning("EventLogger: failed to write event: %s", exc)

    def _make(
        self,
        event_type: str,
        level: str = "INFO",
        plan_id: str | None = None,
        phase: str | None = None,
        message: str = "",
        metadata: dict | None = None,
    ) -> dict:
        return {
            "id": str(uuid.uuid4()),
            "timestamp": self._now(),
            "agent": self.agent,
            "event_type": event_type,
            "level": level,
            "plan_id": plan_id,
            "phase": phase,
            "message": message,
            "metadata": metadata or {},
        }

    def _write_phase_file(self, payload: dict) -> None:
        try:
            self._phase_file.write_text(json.dumps(payload), encoding="utf-8")
        except Exception as exc:
            logger.warning("EventLogger: failed to write phase file: %s", exc)

    def phase(
        self,
        phase: str,
        plan_id: str | None = None,
        message: str = "",
        metadata: dict | None = None,
    ) -> None:
        event = self._make(
            event_type="agent_phase",
            level="INFO",
            plan_id=plan_id,
            phase=phase,
            message=message,
            metadata=metadata,
        )
        self._write(event)
        payload: dict = {"phase": phase, "plan_id": plan_id, "updated_at": event["timestamp"]}
        if phase == "error" and message:
            payload["error_message"] = message
        self._write_phase_file(payload)

    def error(
        self,
        message: str,
        plan_id: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        event = self._make(
            event_type="agent_error",
            level="ERROR",
            plan_id=plan_id,
            phase="error",
            message=message,
            metadata=metadata,
        )
        self._write(event)
        self._write_phase_file({
            "phase": "error",
            "plan_id": plan_id,
            "updated_at": event["timestamp"],
            "error_message": message,
        })

    def event(
        self,
        event_type: str,
        level: str = "INFO",
        plan_id: str | None = None,
        message: str = "",
        metadata: dict | None = None,
    ) -> None:
        self._write(self._make(
            event_type=event_type,
            level=level,
            plan_id=plan_id,
            message=message,
            metadata=metadata,
        ))
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-a
python test_event_logger.py
```

Expected output:
```
  ✓ test_phase_creates_event_file
  ✓ test_error_creates_error_event
  ✓ test_event_sets_plan_id
  ✓ test_phase_writes_phase_file
  ✓ test_error_sets_phase_to_error
  ✓ test_never_raises_on_bad_dir

event_logger tests passed ✓
```

- [ ] **Step 5: Copy to agent-b and agent-c**

```bash
cp /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-a/event_logger.py \
   /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-b/event_logger.py
cp /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-a/event_logger.py \
   /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-c/event_logger.py
```

- [ ] **Step 6: Commit**

```bash
git add agent-a/event_logger.py agent-b/event_logger.py agent-c/event_logger.py agent-a/test_event_logger.py
git commit -m "feat: add EventLogger shared class with tests"
```

---

## Task 2: Docker Compose — events volume

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add `events-data` volume and mount it in all agents + backend**

In `docker-compose.yml`, make these changes:

**Top-level `volumes:` block** — add one line:
```yaml
volumes:
  strategies-data:
  tradeplan-data:
  approval-data:
  events-data:        # ← add this
```

**`agent-a` service `volumes:` block** — add one line:
```yaml
    volumes:
      - strategies-data:/data/strategies
      - events-data:/data/events    # ← add this
```

**`agent-b` service `volumes:` block** — add one line:
```yaml
    volumes:
      - strategies-data:/data/strategies
      - events-data:/data/events    # ← add this
```

**`agent-c` service `volumes:` block** — add one line:
```yaml
    volumes:
      - strategies-data:/data/strategies
      - tradeplan-data:/data/tradeplans
      - approval-data:/data/approvals
      - events-data:/data/events    # ← add this
```

**`myalpaca-backend` service `environment:` block** — add one line:
```yaml
    environment:
      ...
      - APPROVALS_DIR=${APPROVALS_DIR:-/data/approvals}
      - EVENTS_DIR=${EVENTS_DIR:-/data/events}    # ← add this
```

**`myalpaca-backend` service `volumes:` block** — add one line:
```yaml
    volumes:
      - strategies-data:/data/strategies:ro
      - tradeplan-data:/data/tradeplans:ro
      - approval-data:/data/approvals:ro
      - events-data:/data/events:ro    # ← add this
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add events-data shared volume to all containers"
```

---

## Task 3: Instrument Agent A

**Files:**
- Modify: `agent-a/agent.py`
- Modify: `agent-a/main.py`
- Modify: `agent-a/server.py`

- [ ] **Step 1: Update `agent-a/agent.py`**

Add import and EventLogger instantiation after the existing imports:

```python
# At the top of agent-a/agent.py, after existing imports:
from event_logger import EventLogger

_elog = EventLogger(agent="agent-a")
```

Replace the `run_research_with_retry` function body:

```python
def run_research_with_retry() -> bool:
    _elog.phase("researching", message="Starting research run")
    for attempt in range(1, MAX_RETRIES + 1):
        logger.info("agent-a: research attempt %d/%d", attempt, MAX_RETRIES)
        if attempt > 1:
            _elog.phase(
                "retrying",
                message=f"Retry attempt {attempt}/{MAX_RETRIES}",
                metadata={"attempt": attempt, "max": MAX_RETRIES},
            )
        if run_research():
            logger.info("agent-a: research succeeded on attempt %d", attempt)
            _elog.phase("complete", message=f"Research complete on attempt {attempt}")
            return True

        if attempt < MAX_RETRIES:
            logger.warning(
                "agent-a: attempt %d failed — retrying in %d seconds",
                attempt,
                RETRY_DELAY_SECONDS,
            )
            time.sleep(RETRY_DELAY_SECONDS)
        else:
            logger.error("agent-a: all %d attempts failed", MAX_RETRIES)

    _elog.error(f"All {MAX_RETRIES} research attempts failed")
    _send_failure_alert()
    return False
```

- [ ] **Step 2: Update `agent-a/main.py`**

Add import after existing imports:

```python
from event_logger import EventLogger
_elog = EventLogger(agent="agent-a")
```

In the `main()` function, add one line right after `logger.info("agent-a starting...")`:

```python
def main() -> None:
    logger.info("agent-a starting — cron: '%s'", config.AGENT_A_CRON)
    _elog.phase("idle", message="agent-a started, waiting for scheduled run")   # ← add this
    ...
```

- [ ] **Step 3: Update `agent-a/server.py`**

Add `json` and `Path` imports (add to top of file):

```python
import json
from pathlib import Path
```

Replace the `status()` function:

```python
_PHASE_FILE = Path("/tmp/agent-a.phase")

@app.route("/status")
def status():
    with _lock:
        running = _running

    phase_data: dict = {}
    try:
        if _PHASE_FILE.exists():
            phase_data = json.loads(_PHASE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass

    return jsonify({
        "running": running,
        "lastRun": _get_last_run(),
        "phase": phase_data.get("phase"),
        "plan_id": phase_data.get("plan_id"),
        "phase_updated_at": phase_data.get("updated_at"),
        "last_error": phase_data.get("error_message") if phase_data.get("phase") == "error" else None,
    })
```

- [ ] **Step 4: Run existing smoke tests to verify nothing broke**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-a
python test_smoke.py
```

Expected: all 4 tests pass with `agent-a smoke tests passed ✓`

- [ ] **Step 5: Commit**

```bash
git add agent-a/agent.py agent-a/main.py agent-a/server.py
git commit -m "feat(agent-a): add EventLogger phase tracking and extended /status"
```

---

## Task 4: Instrument Agent B

**Files:**
- Modify: `agent-b/agent.py`
- Modify: `agent-b/main.py`
- Modify: `agent-b/server.py`

- [ ] **Step 1: Update `agent-b/agent.py`**

Agent B uses `openai` instead of `anthropic` but has identical retry structure. Add after existing imports:

```python
from event_logger import EventLogger

_elog = EventLogger(agent="agent-b")
```

Replace the `run_research_with_retry` function body (identical pattern to agent-a):

```python
def run_research_with_retry() -> bool:
    _elog.phase("researching", message="Starting research run")
    for attempt in range(1, MAX_RETRIES + 1):
        logger.info("agent-b: research attempt %d/%d", attempt, MAX_RETRIES)
        if attempt > 1:
            _elog.phase(
                "retrying",
                message=f"Retry attempt {attempt}/{MAX_RETRIES}",
                metadata={"attempt": attempt, "max": MAX_RETRIES},
            )
        if run_research():
            logger.info("agent-b: research succeeded on attempt %d", attempt)
            _elog.phase("complete", message=f"Research complete on attempt {attempt}")
            return True

        if attempt < MAX_RETRIES:
            logger.warning(
                "agent-b: attempt %d failed — retrying in %d seconds",
                attempt,
                RETRY_DELAY_SECONDS,
            )
            time.sleep(RETRY_DELAY_SECONDS)
        else:
            logger.error("agent-b: all %d attempts failed", MAX_RETRIES)

    _elog.error(f"All {MAX_RETRIES} research attempts failed")
    _send_failure_alert()
    return False
```

- [ ] **Step 2: Update `agent-b/main.py`**

Add after existing imports:

```python
from event_logger import EventLogger
_elog = EventLogger(agent="agent-b")
```

In `main()`, add one line after the first `logger.info`:

```python
def main() -> None:
    logger.info("agent-b starting — cron: '%s'", config.AGENT_B_CRON)
    _elog.phase("idle", message="agent-b started, waiting for scheduled run")   # ← add this
    ...
```

- [ ] **Step 3: Update `agent-b/server.py`**

Add at top of file with other imports:

```python
import json
from pathlib import Path
```

Replace the `status()` function (same pattern as agent-a, different phase file path):

```python
_PHASE_FILE = Path("/tmp/agent-b.phase")

@app.route("/status")
def status():
    with _lock:
        running = _running

    phase_data: dict = {}
    try:
        if _PHASE_FILE.exists():
            phase_data = json.loads(_PHASE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass

    return jsonify({
        "running": running,
        "lastRun": _get_last_run(),
        "phase": phase_data.get("phase"),
        "plan_id": phase_data.get("plan_id"),
        "phase_updated_at": phase_data.get("updated_at"),
        "last_error": phase_data.get("error_message") if phase_data.get("phase") == "error" else None,
    })
```

- [ ] **Step 4: Run existing smoke tests**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-b
python test_smoke.py
```

Expected: all tests pass with `agent-b smoke tests passed ✓`

- [ ] **Step 5: Commit**

```bash
git add agent-b/agent.py agent-b/main.py agent-b/server.py
git commit -m "feat(agent-b): add EventLogger phase tracking and extended /status"
```

---

## Task 5: Instrument Agent C

**Files:**
- Modify: `agent-c/main.py`
- Modify: `agent-c/executor.py`
- Modify: `agent-c/server.py`

- [ ] **Step 1: Update `agent-c/main.py`**

Add after existing imports:

```python
from event_logger import EventLogger
```

Add EventLogger instantiation and idle phase right after `logger = logging.getLogger(__name__)`:

```python
logger = logging.getLogger(__name__)
_elog = EventLogger(agent="agent-c")
```

At the top of `run_daily()`, add the idle→waiting_strategies phase. Then add a phase call before each of the 10 steps. Replace the full `run_daily()` function with:

```python
async def run_daily() -> None:
    alpaca = MyAlpacaClient(base_url=config.MYALPACA_BASE_URL)
    bridge = ApprovalBridgeClient(base_url=config.APPROVAL_BRIDGE_URL)

    logger.info("agent-c: starting daily execution run")
    _elog.phase("idle", message="Daily run started")

    # ── Step 1: health check ──────────────────────────────────────────────────
    if not alpaca.health_check():
        msg = "myAlpaca service is unreachable — aborting daily run"
        logger.error(msg)
        _elog.error(msg)
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: myAlpaca unreachable",
            html=f"<p>{msg}</p>",
        )
        return

    # ── Step 2: wait for strategies ───────────────────────────────────────────
    _elog.phase("waiting_strategies", message="Polling for strategy files")
    waited_minutes = 0
    while not strategies_ready_for_today():
        if waited_minutes >= STRATEGY_WAIT_MAX_MINUTES:
            msg = f"Strategy files not ready after {STRATEGY_WAIT_MAX_MINUTES}min — aborting"
            logger.error(msg)
            _elog.error(msg)
            bridge.send_notification(
                plan_id="N/A",
                ntype="ALERT",
                subject="[agent-c] ABORT: Strategy files not ready",
                html=f"<p>{msg}</p>",
            )
            return
        logger.info(
            "Strategies not ready yet, waiting %d min… (%d/%d min elapsed)",
            STRATEGY_POLL_MINUTES,
            waited_minutes,
            STRATEGY_WAIT_MAX_MINUTES,
        )
        await asyncio.sleep(STRATEGY_POLL_MINUTES * 60)
        waited_minutes += STRATEGY_POLL_MINUTES

    # ── Step 3: fetch portfolio ───────────────────────────────────────────────
    _elog.phase("building_plan", message="Fetching portfolio")
    try:
        account = alpaca.get_account()
        positions = alpaca.get_positions()
        orders = alpaca.get_orders()
        logger.info(
            "Portfolio fetched: equity=%s, cash=%s",
            account.get("equity"),
            account.get("cash"),
        )
    except Exception as exc:
        msg = f"Failed to fetch portfolio: {exc}"
        logger.error(msg)
        _elog.error(msg, metadata={"exc": str(exc)})
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: Portfolio fetch failed",
            html=f"<p>Failed to fetch portfolio from myAlpaca: {exc}</p>",
        )
        return

    # ── Step 4: read strategy files ───────────────────────────────────────────
    claude_strategy = read_latest_strategy("claude")
    gpt_strategy = read_latest_strategy("gpt")

    if not claude_strategy or not gpt_strategy:
        msg = "Could not read one or both strategy files — aborting"
        logger.error(msg)
        _elog.error(msg)
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: Strategy file read failed",
            html="<p>Could not read claude or gpt strategy file.</p>",
        )
        return

    # ── Step 5: build trade plan ──────────────────────────────────────────────
    _elog.phase("building_plan", message="Generating trade plan with Claude")
    plan = build_trade_plan(
        claude_strategy=claude_strategy,
        gpt_strategy=gpt_strategy,
        account=account,
        positions=positions,
        orders=orders,
    )
    if plan is None:
        msg = "build_trade_plan() returned None — aborting"
        logger.error(msg)
        _elog.error(msg)
        bridge.send_notification(
            plan_id="N/A",
            ntype="ALERT",
            subject="[agent-c] ABORT: Trade plan generation failed",
            html="<p>Claude returned an invalid or unparseable trade plan.</p>",
        )
        return

    plan_id = plan.get("plan_id", "unknown")
    logger.info("Trade plan generated: %s (%d trades)", plan_id, len(plan.get("trades", [])))

    # ── Step 6: persist trade plan ────────────────────────────────────────────
    write_tradeplan(plan)

    # ── Step 7: submit to approval bridge ────────────────────────────────────
    try:
        submission_result = bridge.submit_plan(plan)
        logger.info("Plan submitted: %s", submission_result)
        _elog.event("plan_submitted", plan_id=plan_id, message="Trade plan submitted to approval bridge")
    except Exception as exc:
        msg = f"Failed to submit plan to approval-bridge: {exc}"
        logger.error(msg)
        _elog.error(msg, plan_id=plan_id)
        bridge.send_notification(
            plan_id=plan_id,
            ntype="ALERT",
            subject=f"[agent-c] ABORT: Bridge submission failed — {plan_id}",
            html=f"<p>Failed to submit plan {plan_id} to approval-bridge: {exc}</p>",
        )
        return

    # ── Step 8: poll for decision ─────────────────────────────────────────────
    _elog.phase(
        "awaiting_approval",
        plan_id=plan_id,
        message=f"Waiting for human decision on plan {plan_id}",
    )
    decision = bridge.poll_until_decided(
        plan_id=plan_id,
        timeout_minutes=config.APPROVAL_TIMEOUT_MINUTES,
        interval_seconds=120,
    )
    logger.info("Plan %s decision: %s", plan_id, decision)
    _elog.event(
        "plan_decision",
        level="INFO" if decision == "APPROVED" else "WARN",
        plan_id=plan_id,
        message=f"Plan decision: {decision}",
    )

    # ── Step 9/10: act on decision ────────────────────────────────────────────
    if decision == "APPROVED":
        _elog.phase("executing", plan_id=plan_id, message="Executing approved trades")
        logger.info("Plan APPROVED — executing trades")
        result = execute_plan(plan=plan, alpaca=alpaca, bridge=bridge, elog=_elog)
        logger.info(
            "Execution complete: %d executed, %d failed",
            result["executed"],
            result["failed"],
        )
        _elog.phase(
            "complete",
            plan_id=plan_id,
            message=f"Execution complete: {result['executed']} executed, {result['failed']} failed",
        )
    else:
        msg = f"Plan {plan_id} not executed — decision={decision}"
        logger.warning(msg)
        _elog.phase("complete", plan_id=plan_id, message=msg)
        bridge.send_notification(
            plan_id=plan_id,
            ntype="ALERT",
            subject=f"[agent-c] Trade plan {decision} — {plan_id}",
            html=f"<p>{msg}</p><p>No trades were submitted.</p>",
        )

    logger.info("agent-c: daily execution run complete")
```

Also add the idle phase in the `_run_daily_sync` wrapper so the phase file is set before scheduler fires:

In `main()` function, after `_start_flask(port=5003)`, add:
```python
_elog.phase("idle", message="agent-c started, waiting for scheduled run")
```

- [ ] **Step 2: Update `agent-c/executor.py`**

Add `EventLogger` import and change the function signature to accept an optional `elog` parameter:

```python
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from event_logger import EventLogger

from approval_client import ApprovalBridgeClient
from myalpaca_client import MyAlpacaClient

logger = logging.getLogger(__name__)


def execute_plan(
    plan: dict,
    alpaca: MyAlpacaClient,
    bridge: ApprovalBridgeClient,
    elog: "EventLogger | None" = None,
) -> dict:
    plan_id = plan.get("plan_id", "unknown")
    trades = plan.get("trades", [])
    executed = 0
    failed = 0
    execution_log: list[dict] = []

    logger.info("Executing approved plan %s: %d trades", plan_id, len(trades))

    for trade in trades:
        symbol = trade.get("symbol", "")
        side = trade.get("side", "")
        notional = float(trade.get("notional", 0.0))

        entry = {"symbol": symbol, "side": side, "notional": notional}

        try:
            result = alpaca.execute_trade(symbol=symbol, side=side, notional=notional)
            entry["status"] = "executed"
            entry["result"] = result
            executed += 1
            logger.info("Trade executed: %s %s $%.2f → %s", side, symbol, notional, result)
            if elog:
                elog.event(
                    "trade_executed",
                    plan_id=plan_id,
                    message=f"{side.upper()} {symbol} ${notional:.2f}",
                    metadata={"symbol": symbol, "side": side, "notional": notional},
                )
        except Exception as exc:
            entry["status"] = "failed"
            entry["error"] = str(exc)
            failed += 1
            logger.error("Trade failed: %s %s $%.2f — %s", side, symbol, notional, exc)
            if elog:
                elog.event(
                    "trade_failed",
                    level="ERROR",
                    plan_id=plan_id,
                    message=f"{side.upper()} {symbol} ${notional:.2f} — {exc}",
                    metadata={"symbol": symbol, "side": side, "notional": notional, "error": str(exc)},
                )

        execution_log.append(entry)

    summary = {
        "plan_id": plan_id,
        "date": plan.get("date", ""),
        "executed": executed,
        "failed": failed,
        "total_trades": len(trades),
        "log_entries": len(execution_log),
    }

    logger.info(
        "Execution complete for plan %s: %d executed, %d failed",
        plan_id,
        executed,
        failed,
    )

    try:
        rows = "".join(
            f"<tr><td><b>{e['symbol']}</b></td><td>{e['side'].upper()}</td>"
            f"<td>${e['notional']:.2f}</td><td>{e['status'].upper()}</td></tr>"
            for e in execution_log
        )
        html = f"""
        <html><body>
        <h2>Trade Execution Summary — Plan {plan_id}</h2>
        <p>Executed: <b>{executed}</b> | Failed: <b>{failed}</b> | Total: <b>{len(trades)}</b></p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr><th>Symbol</th><th>Side</th><th>Notional</th><th>Status</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        </body></html>
        """
        bridge.send_notification(
            plan_id=plan_id,
            ntype="EXECUTION_SUMMARY",
            subject=f"Execution Complete — Plan {plan_id} ({executed}/{len(trades)} trades)",
            html=html,
        )
    except Exception as exc:
        logger.warning("Failed to send execution notification: %s", exc)

    return {"executed": executed, "failed": failed, "log": execution_log}
```

- [ ] **Step 3: Update `agent-c/server.py`**

Add at top of file with other imports:

```python
import json
from pathlib import Path
```

Replace the `status()` function:

```python
_PHASE_FILE = Path("/tmp/agent-c.phase")

@app.route("/status")
def status():
    with _lock:
        running = _running

    phase_data: dict = {}
    try:
        if _PHASE_FILE.exists():
            phase_data = json.loads(_PHASE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass

    return jsonify({
        "running": running,
        "lastRun": _get_last_run(),
        "phase": phase_data.get("phase"),
        "plan_id": phase_data.get("plan_id"),
        "phase_updated_at": phase_data.get("updated_at"),
        "last_error": phase_data.get("error_message") if phase_data.get("phase") == "error" else None,
    })
```

- [ ] **Step 4: Run existing smoke tests**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-c
python test_smoke.py
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent-c/main.py agent-c/executor.py agent-c/server.py
git commit -m "feat(agent-c): add EventLogger phase tracking at all 10 execution steps"
```

---

## Task 6: Backend — events route

**Files:**
- Create: `myalpaca/backend/src/routes/events.ts`
- Modify: `myalpaca/backend/src/index.ts`

- [ ] **Step 1: Create `myalpaca/backend/src/routes/events.ts`**

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const EVENTS_DIR = process.env.EVENTS_DIR || '/data/events';

// GET /api/events?agent=agent-c&level=ERROR&limit=200
router.get('/', async (req: Request, res: Response) => {
  const agentFilter = req.query.agent as string | undefined;
  const levelFilter = (req.query.level as string | undefined)?.toUpperCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);

  let files: string[];
  try {
    files = await fs.readdir(EVENTS_DIR);
  } catch {
    return res.json([]);
  }

  const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

  const events = (
    await Promise.all(
      jsonFiles.slice(0, limit * 5).map(async (file) => {
        try {
          const raw = await fs.readFile(path.join(EVENTS_DIR, file), 'utf8');
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
    )
  )
    .filter(Boolean)
    .filter((e: any) => !agentFilter || e.agent === agentFilter)
    .filter((e: any) => !levelFilter || e.level === levelFilter)
    .slice(0, limit);

  res.json(events);
});

// GET /api/events/stream — SSE, pushes new events as they arrive
router.get('/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Start from current newest file — only stream events that arrive after connection
  let lastSeenFile = '';
  try {
    const existing = (await fs.readdir(EVENTS_DIR)).filter(f => f.endsWith('.json')).sort();
    if (existing.length > 0) lastSeenFile = existing[existing.length - 1];
  } catch {}

  const poll = async () => {
    try {
      const files = (await fs.readdir(EVENTS_DIR))
        .filter(f => f.endsWith('.json'))
        .sort()
        .filter(f => f > lastSeenFile);

      for (const file of files) {
        try {
          const raw = await fs.readFile(path.join(EVENTS_DIR, file), 'utf8');
          const event = JSON.parse(raw);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          lastSeenFile = file;
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // events dir not mounted yet
    }
  };

  const interval = setInterval(poll, 3000);
  req.on('close', () => clearInterval(interval));
});

export default router;
```

- [ ] **Step 2: Register the events route in `myalpaca/backend/src/index.ts`**

Add import after the other route imports:

```typescript
import eventsRouter from './routes/events';
```

Add route registration after `app.use('/api/history', historyRouter)`:

```typescript
app.use('/api/events', eventsRouter);
```

Update the startup log to include the new route:

```typescript
console.log('Routes: /api/health, /api/account, /api/trade, /api/wheel, /api/options, /api/intel, /api/agents, /api/history, /api/events');
```

- [ ] **Step 3: Commit**

```bash
git add myalpaca/backend/src/routes/events.ts myalpaca/backend/src/index.ts
git commit -m "feat(backend): add GET /api/events and SSE /api/events/stream"
```

---

## Task 7: Backend — enhanced agent status + approvals/all

**Files:**
- Modify: `myalpaca/backend/src/routes/agents.ts`
- Modify: `myalpaca/backend/src/routes/approvals.ts`

- [ ] **Step 1: Update `myalpaca/backend/src/routes/agents.ts`**

In the `GET /:agent/status` handler, update the type annotation and forward the new fields. Replace the status handler starting at line 87:

```typescript
// GET /api/agents/:agent/status
router.get('/:agent/status', async (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];

  let running = false;
  let lastRun: string | null = null;
  const extra: Record<string, unknown> = {};

  try {
    const r = await fetch(`http://${host}:${port}/status`);
    const data = await r.json() as {
      running: boolean;
      lastRun: string | null;
      phase?: string | null;
      plan_id?: string | null;
      phase_updated_at?: string | null;
      last_error?: string | null;
    };
    running = data.running;
    lastRun = data.lastRun;
    extra.phase = data.phase ?? null;
    extra.plan_id = data.plan_id ?? null;
    extra.phase_updated_at = data.phase_updated_at ?? null;
    extra.last_error = data.last_error ?? null;
  } catch {
    // agent unreachable — report not running
  }

  let nextRun: string | null = null;
  try {
    const interval = CronExpressionParser.parse(AGENT_CRONS[agent], { tz: TZ });
    nextRun = interval.next().toISOString();
  } catch {
    // ignore invalid cron
  }

  if (agent === 'c') {
    extra.strategyReady = await checkStrategiesReady();
  }

  res.json({ running, lastRun, nextRun, ...extra });
});
```

- [ ] **Step 2: Update `myalpaca/backend/src/routes/approvals.ts`**

Add `fs` and `path` imports and a new `/all` route. The full updated file:

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const BRIDGE_URL = (process.env.APPROVAL_BRIDGE_URL ?? 'http://approval-bridge:8080').replace(/\/$/, '');
const APPROVALS_DIR = process.env.APPROVALS_DIR || '/data/approvals';

async function proxyTo(bridgePath: string, req: Request, res: Response): Promise<void> {
  try {
    const url = `${BRIDGE_URL}${bridgePath}`;
    const init: RequestInit = { method: req.method };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(url, init);
    const body = await upstream.text();
    res.status(upstream.status).set('Content-Type', 'application/json').send(body);
  } catch (err: any) {
    res.status(502).json({ error: 'approval-bridge unreachable', detail: err.message });
  }
}

// GET /api/approvals/pending
router.get('/pending', (req, res) => proxyTo('/plans/pending', req, res));

// GET /api/approvals/all — all plans (not just pending), newest first
router.get('/all', async (_req: Request, res: Response) => {
  try {
    const files = await fs.readdir(APPROVALS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
    const records = (
      await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const raw = await fs.readFile(path.join(APPROVALS_DIR, file), 'utf8');
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    res.json(records);
  } catch {
    res.json([]);
  }
});

// GET /api/approvals/:planId/status
router.get('/:planId/status', (req, res) =>
  proxyTo(`/plans/${req.params.planId}/status`, req, res),
);

// POST /api/approvals/:planId/decide
router.post('/:planId/decide', (req, res) =>
  proxyTo(`/plans/${req.params.planId}/decide`, req, res),
);

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add myalpaca/backend/src/routes/agents.ts myalpaca/backend/src/routes/approvals.ts
git commit -m "feat(backend): forward phase/last_error in agent status; add GET /api/approvals/all"
```

---

## Task 8: Fix Approvals page

**Files:**
- Modify: `myalpaca/frontend/src/pages/Approvals.tsx`

- [ ] **Step 1: Fix APPROVE button — remove `overflow-hidden` and add flex safety**

In the card container div (line 145), change:
```tsx
<div key={plan.plan_id} className="bg-[#161B22] border border-[#30363D] rounded overflow-hidden">
```
to:
```tsx
<div key={plan.plan_id} className="bg-[#161B22] border border-[#30363D] rounded">
```

In the action bar button row (line 249), change:
```tsx
<div className="flex gap-3 items-center">
```
to:
```tsx
<div className="flex flex-wrap gap-3 items-center min-w-0">
```

- [ ] **Step 2: Add inline error banner for failed decide calls**

Add a `decideError` state at the top of the `Approvals` component (alongside the existing state):

```tsx
const [decideError, setDecideError] = useState<Record<string, string>>({});
```

In the `decide` function, update the catch block to set the per-plan error:

```tsx
  async function decide(planId: string, decision: 'APPROVED' | 'REJECTED') {
    setDeciding((d) => ({ ...d, [planId]: true }));
    setDecideError((e) => ({ ...e, [planId]: '' }));
    try {
      const res = await fetch(`/api/approvals/${planId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, decision, reason: reasons[planId] ?? null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      fetchPlans();
    } catch (e: any) {
      setDecideError((err) => ({ ...err, [planId]: e.message }));
    } finally {
      setDeciding((d) => ({ ...d, [planId]: false }));
    }
  }
```

Add the error banner inside the action bar section, after the button row (before the reason input):

```tsx
              {/* Action bar */}
              {isPending && (
                <div className="border-t border-[#30363D] pt-4 space-y-3">
                  <div className="flex flex-wrap gap-3 items-center min-w-0">
                    <button
                      onClick={() => decide(plan.plan_id, 'APPROVED')}
                      disabled={isDeciding}
                      className="px-5 py-2 bg-[#238636] hover:bg-[#2EA043] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded font-mono transition-colors"
                    >
                      {isDeciding ? 'Processing...' : 'APPROVE'}
                    </button>
                    <button
                      onClick={() =>
                        showReason[plan.plan_id]
                          ? decide(plan.plan_id, 'REJECTED')
                          : setShowReason((s) => ({ ...s, [plan.plan_id]: true }))
                      }
                      disabled={isDeciding}
                      className="px-5 py-2 bg-[#21262D] hover:bg-red-900/40 border border-[#30363D] hover:border-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-[#FF5000] text-sm rounded font-mono transition-colors"
                    >
                      {showReason[plan.plan_id] ? 'Confirm Reject' : 'REJECT'}
                    </button>
                    {showReason[plan.plan_id] && (
                      <button
                        onClick={() => setShowReason((s) => ({ ...s, [plan.plan_id]: false }))}
                        className="text-xs text-[#8B949E] hover:text-white font-mono"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {decideError[plan.plan_id] && (
                    <div className="bg-red-900/20 border border-red-500/30 rounded px-3 py-2">
                      <p className="text-red-400 font-mono text-xs">{decideError[plan.plan_id]}</p>
                    </div>
                  )}
                  {showReason[plan.plan_id] && (
                    <input
                      type="text"
                      placeholder="Reason for rejection (optional)"
                      value={reasons[plan.plan_id] ?? ''}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [plan.plan_id]: e.target.value }))
                      }
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded p-2 text-white font-mono text-sm focus:outline-none focus:border-red-500/50 placeholder-[#8B949E]"
                    />
                  )}
                </div>
              )}
```

- [ ] **Step 3: Add Re-run Agent C button for non-pending plans**

Replace the existing `{/* Decided state */}` block (lines 291–301) with:

```tsx
              {/* Decided state + retry */}
              {!isPending && (
                <div className="border-t border-[#30363D] pt-4 space-y-3">
                  {plan.decision && (
                    <p className="text-xs text-[#8B949E] font-mono">
                      Decision: {statusBadge(plan.decision)}
                      {plan.decided_at && (
                        <span className="ml-2">at {new Date(plan.decided_at).toLocaleString()}</span>
                      )}
                    </p>
                  )}
                  {(plan.status === 'REJECTED' || plan.status === 'EXPIRED') && (
                    <button
                      onClick={async () => {
                        await fetch('/api/agents/c/trigger', { method: 'POST' });
                      }}
                      className="text-xs px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] hover:text-white rounded font-mono transition-colors"
                    >
                      Re-run Agent C
                    </button>
                  )}
                </div>
              )}
```

- [ ] **Step 4: Commit**

```bash
git add myalpaca/frontend/src/pages/Approvals.tsx
git commit -m "fix(approvals): fix APPROVE button clipping, add decision error banner and retry"
```

---

## Task 9: Enhance Agents page

**Files:**
- Modify: `myalpaca/frontend/src/pages/Agents.tsx`

- [ ] **Step 1: Extend the `AgentStatus` interface and add phase labels**

Replace the existing `AgentStatus` interface and add a `PHASE_LABELS` constant after it:

```tsx
interface AgentStatus {
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  strategyReady?: boolean;
  phase?: string | null;
  plan_id?: string | null;
  phase_updated_at?: string | null;
  last_error?: string | null;
}

const PHASE_LABELS: Record<string, string> = {
  idle:                 'Idle',
  waiting_strategies:   'Waiting for strategies',
  building_plan:        'Building trade plan',
  awaiting_approval:    'Waiting for your approval',
  executing:            'Executing trades',
  complete:             'Complete',
  researching:          'Researching',
  retrying:             'Retrying',
  error:                'Error',
};

function phaseColor(phase: string): string {
  if (phase === 'complete') return 'text-green-400';
  if (phase === 'error') return 'text-red-400';
  if (phase === 'idle') return 'text-[#8B949E]';
  return 'text-yellow-400';
}
```

- [ ] **Step 2: Add phase display and error banner inside `AgentCard`**

Inside the `AgentCard` return JSX, after the `<div className="text-xs text-[#8B949E] font-mono space-y-0.5">` block (after lastRun/nextRun display, before the button row), add:

```tsx
      {/* Phase indicator */}
      {status?.phase && status.phase !== 'idle' && (
        <div className={`text-xs font-mono flex items-center gap-2 ${phaseColor(status.phase)}`}>
          <span>●</span>
          <span>{PHASE_LABELS[status.phase] ?? status.phase}</span>
          {status.plan_id && (
            <span className="text-[#8B949E]">· {status.plan_id.slice(0, 8)}</span>
          )}
        </div>
      )}

      {/* Error banner */}
      {status?.last_error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded px-3 py-2 space-y-1">
          <p className="text-xs text-red-400 font-mono">{status.last_error}</p>
          <button
            onClick={handleRunNow}
            disabled={running || !canRun}
            className="text-xs px-2 py-0.5 bg-[#21262D] hover:bg-[#30363D] border border-red-500/30 text-red-400 rounded font-mono transition-colors disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}
```

- [ ] **Step 3: Speed up the status poll to every 10 seconds**

In the `useEffect` that calls `fetchStatus`, change the interval from `30_000` to `10_000`:

```tsx
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10_000);   // was 30_000
    return () => {
      clearInterval(id);
      ...
    };
  }, [fetchStatus]);
```

- [ ] **Step 4: Commit**

```bash
git add myalpaca/frontend/src/pages/Agents.tsx
git commit -m "feat(agents): add live phase display and error banner with retry"
```

---

## Task 10: New Logs page + nav update

**Files:**
- Create: `myalpaca/frontend/src/pages/Logs.tsx`
- Modify: `myalpaca/frontend/src/App.tsx`

- [ ] **Step 1: Create `myalpaca/frontend/src/pages/Logs.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';

interface LogEvent {
  id: string;
  timestamp: string;
  agent: string;
  event_type: string;
  level: string;
  plan_id: string | null;
  phase: string | null;
  message: string;
  metadata: Record<string, unknown>;
}

const LEVEL_STYLES: Record<string, string> = {
  INFO:  'text-[#8B949E]',
  WARN:  'text-yellow-400',
  ERROR: 'text-red-400',
};

const ROW_BG: Record<string, string> = {
  WARN:  'bg-yellow-900/10',
  ERROR: 'bg-red-900/20',
};

const TYPE_COLOR: Record<string, string> = {
  agent_phase:    'text-blue-400',
  agent_error:    'text-red-400',
  plan_submitted: 'text-purple-400',
  plan_decision:  'text-yellow-400',
  trade_executed: 'text-green-400',
  trade_failed:   'text-orange-400',
};

export default function Logs() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  function fetchEvents() {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (agentFilter) params.set('agent', agentFilter);
    if (levelFilter) params.set('level', levelFilter);
    fetch(`/api/events?${params}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: LogEvent[]) => { setEvents(data); setError(null); })
      .catch(() => setError('Failed to load events. Is the backend running?'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchEvents(); }, [agentFilter, levelFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) { esRef.current?.close(); esRef.current = null; return; }
    const es = new EventSource('/api/events/stream');
    esRef.current = es;
    es.onmessage = (e) => {
      const ev: LogEvent = JSON.parse(e.data);
      setEvents(prev => [ev, ...prev].slice(0, 500));
    };
    return () => { es.close(); esRef.current = null; };
  }, [live]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-white">Event Logs</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="bg-[#161B22] border border-[#30363D] text-[#8B949E] text-xs rounded px-2 py-1 font-mono"
          >
            <option value="">All agents</option>
            <option value="agent-a">Agent A</option>
            <option value="agent-b">Agent B</option>
            <option value="agent-c">Agent C</option>
          </select>
          <select
            value={levelFilter}
            onChange={e => setLevelFilter(e.target.value)}
            className="bg-[#161B22] border border-[#30363D] text-[#8B949E] text-xs rounded px-2 py-1 font-mono"
          >
            <option value="">All levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
          <button
            onClick={() => setLive(l => !l)}
            className={`text-xs px-3 py-1 rounded font-mono border transition-colors ${
              live
                ? 'bg-green-900/30 border-green-500/30 text-green-400'
                : 'bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-white'
            }`}
          >
            {live ? '● Live' : 'Live'}
          </button>
          <button
            onClick={fetchEvents}
            className="text-xs text-[#8B949E] hover:text-white font-mono border border-[#30363D] px-3 py-1 rounded hover:border-[#8B949E] transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded p-3">
          <p className="text-red-400 font-mono text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-[#8B949E] font-mono text-sm">Loading events…</p>
      ) : events.length === 0 ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded p-8 text-center">
          <p className="text-[#8B949E] font-mono text-sm">
            No events yet — run an agent to generate the first events.
          </p>
        </div>
      ) : (
        <div className="border border-[#30363D] rounded overflow-hidden">
          <table className="w-full text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-[#30363D] bg-[#161B22] text-[#8B949E] uppercase">
                <th className="text-left py-2 px-3 whitespace-nowrap">Time</th>
                <th className="text-left py-2 px-3">Agent</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Level</th>
                <th className="text-left py-2 px-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <>
                  <tr
                    key={ev.id}
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                    className={`border-b border-[#21262D] cursor-pointer hover:bg-[#161B22] transition-colors ${ROW_BG[ev.level] ?? ''}`}
                  >
                    <td className="py-1.5 px-3 text-[#8B949E] whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-1.5 px-3 text-white">{ev.agent}</td>
                    <td className={`py-1.5 px-3 ${TYPE_COLOR[ev.event_type] ?? 'text-[#8B949E]'}`}>
                      {ev.event_type}
                    </td>
                    <td className={`py-1.5 px-3 ${LEVEL_STYLES[ev.level] ?? 'text-[#8B949E]'}`}>
                      {ev.level}
                    </td>
                    <td className="py-1.5 px-3 text-[#E6EDF3] max-w-sm truncate">
                      {ev.message}
                    </td>
                  </tr>
                  {expanded === ev.id && (
                    <tr key={`${ev.id}-exp`} className="border-b border-[#21262D]">
                      <td colSpan={5} className="px-3 py-3 bg-[#0D1117]">
                        <pre className="text-[#8B949E] text-xs whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(ev, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `myalpaca/frontend/src/App.tsx`**

Add the Logs import:

```tsx
import Logs from './pages/Logs';
```

In the nav links array, add Logs between Agents and History:

```tsx
          {[
            { to: '/',          label: 'Dashboard' },
            { to: '/trade',     label: 'Trade'     },
            { to: '/approvals', label: 'Approvals' },
            { to: '/agents',    label: 'Agents'    },
            { to: '/logs',      label: 'Logs'      },   // ← add this
            { to: '/history',   label: 'History'   },
          ].map(({ to, label }) => (
```

Add the route inside `<Routes>`:

```tsx
          <Route path="/logs"      element={<Logs />} />
```

- [ ] **Step 3: Commit**

```bash
git add myalpaca/frontend/src/pages/Logs.tsx myalpaca/frontend/src/App.tsx
git commit -m "feat(frontend): add Logs page with live SSE stream, filters, and expandable events"
```

---

## Task 11: Rebuild and verify

- [ ] **Step 1: Rebuild all containers**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader
docker compose down && docker compose up --build -d
```

- [ ] **Step 2: Verify all containers are healthy**

```bash
docker compose ps
```

Expected: 6 containers all `Up` or `healthy`

- [ ] **Step 3: Trigger Agent A and verify events appear**

```bash
curl -X POST http://localhost:3001/api/agents/a/trigger
sleep 5
curl http://localhost:3001/api/events | python3 -m json.tool | head -40
```

Expected: JSON array containing at least one `agent_phase` event with `agent: "agent-a"` and `phase: "researching"`

- [ ] **Step 4: Verify enhanced agent status returns phase**

```bash
curl http://localhost:3001/api/agents/a/status | python3 -m json.tool
```

Expected: response includes `"phase"` and `"last_error"` fields (not just `running`/`lastRun`)

- [ ] **Step 5: Open the app and verify UI**

Open `http://localhost:5173/logs` — should show event rows
Open `http://localhost:5173/agents` — Agent A card should show current phase
Open `http://localhost:5173/approvals` — verify APPROVE and REJECT buttons both visible

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: rebuild verification complete — event log system live"
```
