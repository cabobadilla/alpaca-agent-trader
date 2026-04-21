# Agents + History Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Agents page (schedule + live-log Run Now for A/B, manual trigger for C) and a History page (expandable table of Agent C runs with approval outcomes) to the myalpaca frontend.

**Architecture:** Each agent container gets a small Flask HTTP server (daemon thread) that exposes `/trigger` and `/logs` (SSE). The myalpaca-backend proxies those calls and adds a `/api/history` route that joins tradeplan JSON files with approval records from disk. Two new React pages consume these APIs.

**Tech Stack:** Python/Flask (agents), Node.js/Express/TypeScript (backend), React/TypeScript/Tailwind (frontend), `cron-parser` npm package, built-in Node `http` + `fetch` for proxying.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `agent-a/server.py` | Flask server: `/status`, `/trigger`, `/logs` SSE |
| Modify | `agent-a/requirements.txt` | Add `flask>=3.0.0` |
| Modify | `agent-a/main.py` | Start Flask server before BlockingScheduler |
| Create | `agent-b/server.py` | Same as agent-a but prefix=`gpt`, port=5002 |
| Modify | `agent-b/requirements.txt` | Add `flask>=3.0.0` |
| Modify | `agent-b/main.py` | Start Flask server before BlockingScheduler |
| Create | `agent-c/server.py` | Flask server: `/status`, `/trigger` only (no SSE) |
| Modify | `agent-c/requirements.txt` | Add `flask>=3.0.0` |
| Modify | `agent-c/main.py` | Start Flask server before sleep loop |
| Modify | `myalpaca/backend/package.json` | Add `cron-parser` dependency |
| Create | `myalpaca/backend/src/routes/agents.ts` | `/api/agents/:agent/trigger`, `/logs`, `/status` |
| Create | `myalpaca/backend/src/routes/history.ts` | `/api/history` — joins tradeplans + approvals |
| Modify | `myalpaca/backend/src/index.ts` | Mount agents + history routers |
| Modify | `docker-compose.yml` | Volume mounts for backend; cron vars for backend |
| Create | `myalpaca/frontend/src/pages/Agents.tsx` | Agent cards with schedule, Run Now, log panel |
| Create | `myalpaca/frontend/src/pages/History.tsx` | Expandable history table |
| Modify | `myalpaca/frontend/src/App.tsx` | Add Agents + History nav links and routes |

---

## Task 1: docker-compose.yml — Backend volumes + env vars

**Files:**
- Modify: `docker-compose.yml`

The backend needs read access to `/data/strategies`, `/data/tradeplans`, and `/data/approvals` for the history and strategyReady routes. It also needs the agent cron expressions to compute next run times.

- [ ] **Step 1: Add volume mounts and env vars to myalpaca-backend**

In `docker-compose.yml`, replace the `myalpaca-backend` service block with:

```yaml
  myalpaca-backend:
    build:
      context: ./myalpaca/backend
      dockerfile: Dockerfile
    container_name: myalpaca-backend
    restart: unless-stopped
    env_file: .env
    environment:
      - TZ=${TZ:-America/New_York}
      - ALPACA_API_KEY=${ALPACA_API_KEY}
      - ALPACA_SECRET_KEY=${ALPACA_SECRET_KEY}
      - ALPACA_BASE_URL=${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}
      - APPROVAL_BRIDGE_URL=${APPROVAL_BRIDGE_URL:-http://approval-bridge:8080}
      - FRONTEND_URL=${FRONTEND_URL:-http://localhost:5173}
      - NODE_TLS_REJECT_UNAUTHORIZED=0
      - AGENT_A_CRON=${AGENT_A_CRON:-0 6 * * 1}
      - AGENT_B_CRON=${AGENT_B_CRON:-0 6 * * 1}
      - AGENT_C_CRON=${AGENT_C_CRON:-0 9 * * 1-5}
      - STRATEGIES_DIR=${STRATEGIES_DIR:-/data/strategies}
      - TRADEPLANS_DIR=${TRADEPLANS_DIR:-/data/tradeplans}
      - APPROVALS_DIR=${APPROVALS_DIR:-/data/approvals}
    volumes:
      - strategies-data:/data/strategies:ro
      - tradeplan-data:/data/tradeplans:ro
      - approval-data:/data/approvals:ro
    ports:
      - "3001:3001"
    networks:
      - alpaca-net
    depends_on:
      approval-bridge:
        condition: service_healthy
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add data volume mounts and agent cron vars to myalpaca-backend"
```

---

## Task 2: agent-a Flask server

**Files:**
- Create: `agent-a/server.py`
- Modify: `agent-a/requirements.txt`
- Modify: `agent-a/main.py`

- [ ] **Step 1: Create `agent-a/server.py`**

```python
"""
agent-a/server.py
-----------------
Flask HTTP server for on-demand trigger and live log streaming.
Runs in a daemon thread alongside BlockingScheduler.

Endpoints:
  GET  /status  — {"running": bool, "lastRun": ISO8601|null}
  POST /trigger — 200 {"status":"started"} | 409 {"status":"already_running"}
  GET  /logs    — SSE stream; sends "__done__" on completion
"""

import glob
import json
import logging
import os
import threading
from datetime import datetime

from flask import Flask, Response, jsonify

app = Flask(__name__)

_running = False
_lock = threading.Lock()
_log_buf: list[str] = []
_log_cond = threading.Condition(_lock)

_STRATEGIES_DIR = os.environ.get("STRATEGIES_DIR", "/data/strategies")
_STRATEGY_PREFIX = "claude"


class _SSEHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        with _log_cond:
            _log_buf.append(msg)
            _log_cond.notify_all()


_handler = _SSEHandler()
_handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", datefmt="%H:%M:%S"))


def _get_last_run() -> str | None:
    pattern = os.path.join(_STRATEGIES_DIR, f"strategy_{_STRATEGY_PREFIX}_*.md")
    files = glob.glob(pattern)
    if not files:
        return None
    latest = max(files, key=os.path.getmtime)
    return datetime.utcfromtimestamp(os.path.getmtime(latest)).isoformat() + "Z"


@app.route("/status")
def status():
    with _lock:
        running = _running
    return jsonify({"running": running, "lastRun": _get_last_run()})


@app.route("/trigger", methods=["POST"])
def trigger():
    global _running, _log_buf
    with _lock:
        if _running:
            return jsonify({"status": "already_running"}), 409
        _running = True
        _log_buf = []
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"status": "started"}), 200


def _run() -> None:
    global _running
    root = logging.getLogger()
    root.addHandler(_handler)
    try:
        from agent import run_research_with_retry
        run_research_with_retry()
    except Exception as exc:
        logging.error("Agent run failed: %s", exc)
    finally:
        root.removeHandler(_handler)
        with _log_cond:
            _log_buf.append("__done__")
            _running = False
            _log_cond.notify_all()


@app.route("/logs")
def logs():
    def generate():
        idx = 0
        while True:
            with _log_cond:
                while idx >= len(_log_buf):
                    if not _running:
                        return
                    _log_cond.wait(timeout=1)
                line = _log_buf[idx]
                idx += 1
            yield f"data: {json.dumps(line)}\n\n"
            if line == "__done__":
                return

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def start(port: int = 5001) -> None:
    """Start Flask in a daemon thread. Must be called before any blocking scheduler."""
    threading.Thread(
        target=lambda: app.run(host="0.0.0.0", port=port, threaded=True),
        daemon=True,
        name="flask-server",
    ).start()
```

- [ ] **Step 2: Add flask to `agent-a/requirements.txt`**

Append to the file:

```
flask>=3.0.0
```

Full file after edit:

```
anthropic>=0.25.0
apscheduler>=3.10.4,<4.0
httpx>=0.27.0
python-dotenv>=1.0.0
flask>=3.0.0
```

- [ ] **Step 3: Update `agent-a/main.py` to start Flask before the scheduler**

Add import at the top (after existing imports):

```python
from server import start as _start_flask
```

In the `main()` function, add `_start_flask(port=5001)` right after `_start_heartbeat()` and before `scheduler.start()`:

```python
def main() -> None:
    logger.info("agent-a starting — cron: '%s'", config.AGENT_A_CRON)

    scheduler = BlockingScheduler(timezone=config.TZ)
    trigger = _build_trigger()

    job = scheduler.add_job(
        run_research_with_retry,
        trigger=trigger,
        id="agent_a_research",
        name="Agent A Weekly Research",
    )

    next_run = job.next_run_time
    logger.info(
        "agent-a scheduled — next fire time: %s (cron: '%s')",
        next_run,
        config.AGENT_A_CRON,
    )

    _start_heartbeat()
    _start_flask(port=5001)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-a shutting down")
```

- [ ] **Step 4: Verify server.py syntax**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-a
python -c "import ast; ast.parse(open('server.py').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add agent-a/server.py agent-a/requirements.txt agent-a/main.py
git commit -m "feat(agent-a): add Flask trigger/logs/status server"
```

---

## Task 3: agent-b Flask server

**Files:**
- Create: `agent-b/server.py`
- Modify: `agent-b/requirements.txt`
- Modify: `agent-b/main.py`

- [ ] **Step 1: Create `agent-b/server.py`**

Identical to `agent-a/server.py` with two differences: `_STRATEGY_PREFIX = "gpt"` and default port 5002.

```python
"""
agent-b/server.py
-----------------
Flask HTTP server for on-demand trigger and live log streaming.
Runs in a daemon thread alongside BlockingScheduler.

Endpoints:
  GET  /status  — {"running": bool, "lastRun": ISO8601|null}
  POST /trigger — 200 {"status":"started"} | 409 {"status":"already_running"}
  GET  /logs    — SSE stream; sends "__done__" on completion
"""

import glob
import json
import logging
import os
import threading
from datetime import datetime

from flask import Flask, Response, jsonify

app = Flask(__name__)

_running = False
_lock = threading.Lock()
_log_buf: list[str] = []
_log_cond = threading.Condition(_lock)

_STRATEGIES_DIR = os.environ.get("STRATEGIES_DIR", "/data/strategies")
_STRATEGY_PREFIX = "gpt"


class _SSEHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        with _log_cond:
            _log_buf.append(msg)
            _log_cond.notify_all()


_handler = _SSEHandler()
_handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", datefmt="%H:%M:%S"))


def _get_last_run() -> str | None:
    pattern = os.path.join(_STRATEGIES_DIR, f"strategy_{_STRATEGY_PREFIX}_*.md")
    files = glob.glob(pattern)
    if not files:
        return None
    latest = max(files, key=os.path.getmtime)
    return datetime.utcfromtimestamp(os.path.getmtime(latest)).isoformat() + "Z"


@app.route("/status")
def status():
    with _lock:
        running = _running
    return jsonify({"running": running, "lastRun": _get_last_run()})


@app.route("/trigger", methods=["POST"])
def trigger():
    global _running, _log_buf
    with _lock:
        if _running:
            return jsonify({"status": "already_running"}), 409
        _running = True
        _log_buf = []
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"status": "started"}), 200


def _run() -> None:
    global _running
    root = logging.getLogger()
    root.addHandler(_handler)
    try:
        from agent import run_research_with_retry
        run_research_with_retry()
    except Exception as exc:
        logging.error("Agent run failed: %s", exc)
    finally:
        root.removeHandler(_handler)
        with _log_cond:
            _log_buf.append("__done__")
            _running = False
            _log_cond.notify_all()


@app.route("/logs")
def logs():
    def generate():
        idx = 0
        while True:
            with _log_cond:
                while idx >= len(_log_buf):
                    if not _running:
                        return
                    _log_cond.wait(timeout=1)
                line = _log_buf[idx]
                idx += 1
            yield f"data: {json.dumps(line)}\n\n"
            if line == "__done__":
                return

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def start(port: int = 5002) -> None:
    """Start Flask in a daemon thread. Must be called before any blocking scheduler."""
    threading.Thread(
        target=lambda: app.run(host="0.0.0.0", port=port, threaded=True),
        daemon=True,
        name="flask-server",
    ).start()
```

- [ ] **Step 2: Add flask to `agent-b/requirements.txt`**

```
anthropic>=0.25.0
apscheduler>=3.10.4,<4.0
httpx>=0.27.0
python-dotenv>=1.0.0
flask>=3.0.0
```

Wait — agent-b uses openai not anthropic. The correct full file:

```
openai>=1.30.0
apscheduler>=3.10.4,<4.0
httpx>=0.27.0
python-dotenv>=1.0.0
flask>=3.0.0
```

- [ ] **Step 3: Update `agent-b/main.py`**

Add import after existing imports:

```python
from server import start as _start_flask
```

In `main()`, add `_start_flask(port=5002)` after `_start_heartbeat()`:

```python
def main() -> None:
    logger.info("agent-b starting — cron: '%s'", config.AGENT_B_CRON)

    scheduler = BlockingScheduler(timezone=config.TZ)
    trigger = _build_trigger()

    job = scheduler.add_job(
        run_research_with_retry,
        trigger=trigger,
        id="agent_b_research",
        name="Agent B Weekly Research",
    )

    next_run = job.next_run_time
    logger.info(
        "agent-b scheduled — next fire time: %s (cron: '%s')",
        next_run,
        config.AGENT_B_CRON,
    )

    _start_heartbeat()
    _start_flask(port=5002)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-b shutting down")
```

- [ ] **Step 4: Verify syntax**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-b
python -c "import ast; ast.parse(open('server.py').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add agent-b/server.py agent-b/requirements.txt agent-b/main.py
git commit -m "feat(agent-b): add Flask trigger/logs/status server"
```

---

## Task 4: agent-c Flask server

**Files:**
- Create: `agent-c/server.py`
- Modify: `agent-c/requirements.txt`
- Modify: `agent-c/main.py`

- [ ] **Step 1: Create `agent-c/server.py`**

Agent C is long-running async — no SSE. Trigger fires `run_daily()` in a new event loop thread.

```python
"""
agent-c/server.py
-----------------
Flask HTTP server for manual triggering of agent-c's daily execution workflow.
No SSE — the run is long-running (up to 2h) and async.

Endpoints:
  GET  /status  — {"running": bool, "lastRun": ISO8601|null}
  POST /trigger — 200 {"status":"started"} | 409 {"status":"already_running"}
"""

import asyncio
import glob
import logging
import os
import threading
from datetime import datetime

from flask import Flask, jsonify

app = Flask(__name__)

_running = False
_lock = threading.Lock()

_TRADEPLANS_DIR = os.environ.get("TRADEPLANS_DIR", "/data/tradeplans")


def _get_last_run() -> str | None:
    pattern = os.path.join(_TRADEPLANS_DIR, "tradeplan_*.json")
    files = glob.glob(pattern)
    if not files:
        return None
    latest = max(files, key=os.path.getmtime)
    return datetime.utcfromtimestamp(os.path.getmtime(latest)).isoformat() + "Z"


@app.route("/status")
def status():
    with _lock:
        running = _running
    return jsonify({"running": running, "lastRun": _get_last_run()})


@app.route("/trigger", methods=["POST"])
def trigger():
    global _running
    with _lock:
        if _running:
            return jsonify({"status": "already_running"}), 409
        _running = True
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"status": "started"}), 200


def _run() -> None:
    global _running
    try:
        from main import run_daily
        asyncio.run(run_daily())
    except Exception as exc:
        logging.error("Agent C run failed: %s", exc)
    finally:
        with _lock:
            _running = False


def start(port: int = 5003) -> None:
    """Start Flask in a daemon thread."""
    threading.Thread(
        target=lambda: app.run(host="0.0.0.0", port=port, threaded=True),
        daemon=True,
        name="flask-server",
    ).start()
```

- [ ] **Step 2: Add flask to `agent-c/requirements.txt`**

```
anthropic>=0.25.0
apscheduler>=3.10.4,<4.0
httpx>=0.27.0
python-dotenv>=1.0.0
flask>=3.0.0
```

- [ ] **Step 3: Update `agent-c/main.py`**

Add import after existing imports:

```python
from server import start as _start_flask
```

In `main()`, add `_start_flask(port=5003)` after `scheduler.start()` and before the `while True` loop:

```python
def main() -> None:
    logger.info("agent-c starting — cron: '%s'", config.AGENT_C_CRON)

    scheduler = BackgroundScheduler(timezone=config.TZ)

    cron_parts = config.AGENT_C_CRON.strip().split()
    trigger = CronTrigger(
        minute=cron_parts[0],
        hour=cron_parts[1],
        day=cron_parts[2],
        month=cron_parts[3],
        day_of_week=cron_parts[4],
        timezone=config.TZ,
    )
    scheduler.add_job(_run_daily_sync, trigger=trigger, id="agent_c_execution")
    scheduler.add_job(
        _write_heartbeat,
        "interval",
        seconds=30,
        id="agent_c_heartbeat",
    )

    scheduler.start()
    logger.info("Scheduler started — waiting for next trigger")
    _start_flask(port=5003)

    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        logger.info("agent-c shutting down")
        scheduler.shutdown()
```

- [ ] **Step 4: Verify syntax**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/agent-c
python -c "import ast; ast.parse(open('server.py').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add agent-c/server.py agent-c/requirements.txt agent-c/main.py
git commit -m "feat(agent-c): add Flask trigger/status server"
```

---

## Task 5: Backend — install cron-parser and create agents route

**Files:**
- Modify: `myalpaca/backend/package.json`
- Create: `myalpaca/backend/src/routes/agents.ts`

- [ ] **Step 1: Install cron-parser**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/myalpaca/backend
npm install cron-parser
```

Expected: `package.json` updated, `node_modules/cron-parser` present.

- [ ] **Step 2: Create `myalpaca/backend/src/routes/agents.ts`**

```typescript
import { Router, Request, Response } from 'express';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import cronParser from 'cron-parser';

const router = Router();

const AGENT_HOSTS: Record<string, { host: string; port: number }> = {
  a: { host: process.env.AGENT_A_HOST || 'agent-a', port: 5001 },
  b: { host: process.env.AGENT_B_HOST || 'agent-b', port: 5002 },
  c: { host: process.env.AGENT_C_HOST || 'agent-c', port: 5003 },
};

const AGENT_CRONS: Record<string, string> = {
  a: process.env.AGENT_A_CRON || '0 6 * * 1',
  b: process.env.AGENT_B_CRON || '0 6 * * 1',
  c: process.env.AGENT_C_CRON || '0 9 * * 1-5',
};

const TZ = process.env.TZ || 'America/New_York';
const STRATEGIES_DIR = process.env.STRATEGIES_DIR || '/data/strategies';

function isValidAgent(agent: string): agent is 'a' | 'b' | 'c' {
  return ['a', 'b', 'c'].includes(agent);
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

async function checkStrategiesReady(): Promise<boolean> {
  const now = new Date();
  const week = isoWeek(now);
  const weekStr = `${now.getFullYear()}-${String(week).padStart(2, '0')}`;
  try {
    await fs.access(path.join(STRATEGIES_DIR, `strategy_claude_${weekStr}.md`));
    await fs.access(path.join(STRATEGIES_DIR, `strategy_gpt_${weekStr}.md`));
    return true;
  } catch {
    return false;
  }
}

// POST /api/agents/:agent/trigger
router.post('/:agent/trigger', async (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];
  try {
    const r = await fetch(`http://${host}:${port}/trigger`, { method: 'POST' });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Cannot reach agent-${agent}: ${err.message}` });
  }
});

// GET /api/agents/:agent/logs — SSE proxy
router.get('/:agent/logs', (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const agentReq = http.get({ host, port, path: '/logs' }, (agentRes) => {
    agentRes.pipe(res);
    req.on('close', () => { agentReq.destroy(); agentRes.destroy(); });
  });

  agentReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify('Connection error: ' + err.message)}\n\n`);
    res.write(`data: ${JSON.stringify('__done__')}\n\n`);
    res.end();
  });
});

// GET /api/agents/:agent/status
router.get('/:agent/status', async (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];

  let running = false;
  let lastRun: string | null = null;
  try {
    const r = await fetch(`http://${host}:${port}/status`);
    const data = await r.json() as { running: boolean; lastRun: string | null };
    running = data.running;
    lastRun = data.lastRun;
  } catch {
    // agent unreachable — report not running
  }

  let nextRun: string | null = null;
  try {
    const interval = cronParser.parseExpression(AGENT_CRONS[agent], { tz: TZ });
    nextRun = interval.next().toISOString();
  } catch {
    // ignore invalid cron
  }

  const extra: Record<string, unknown> = {};
  if (agent === 'c') {
    extra.strategyReady = await checkStrategiesReady();
  }

  res.json({ running, lastRun, nextRun, ...extra });
});

export default router;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/myalpaca/backend
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to agents.ts).

- [ ] **Step 4: Commit**

```bash
git add myalpaca/backend/package.json myalpaca/backend/package-lock.json myalpaca/backend/src/routes/agents.ts
git commit -m "feat(backend): add /api/agents trigger/logs/status routes"
```

---

## Task 6: Backend — history route

**Files:**
- Create: `myalpaca/backend/src/routes/history.ts`

- [ ] **Step 1: Create `myalpaca/backend/src/routes/history.ts`**

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

const TRADEPLANS_DIR = process.env.TRADEPLANS_DIR || '/data/tradeplans';
const APPROVALS_DIR = process.env.APPROVALS_DIR || '/data/approvals';

const APPROVAL_DISPLAY_STATUS: Record<string, string> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  AWAITING_SEND: 'PENDING',
  EMAIL_SENT: 'PENDING',
  AWAITING_REPLY: 'PENDING',
};

router.get('/', async (_req: Request, res: Response) => {
  let files: string[];
  try {
    files = await fs.readdir(TRADEPLANS_DIR);
  } catch {
    return res.json([]);
  }

  const planFiles = files
    .filter(f => f.startsWith('tradeplan_') && f.endsWith('.json'))
    .sort()
    .reverse();

  const plans = await Promise.all(
    planFiles.map(async (file) => {
      const raw = await fs.readFile(path.join(TRADEPLANS_DIR, file), 'utf8');
      const plan = JSON.parse(raw);

      let approvalStatus = 'PENDING';
      let rejectionReason: string | null = null;

      try {
        const approvalRaw = await fs.readFile(
          path.join(APPROVALS_DIR, `${plan.plan_id}.json`),
          'utf8'
        );
        const approval = JSON.parse(approvalRaw);
        approvalStatus = APPROVAL_DISPLAY_STATUS[approval.status] ?? approval.status;
        rejectionReason = approval.rejection_reason ?? null;
      } catch {
        // no approval record yet — stays PENDING
      }

      return { ...plan, approvalStatus, rejectionReason };
    })
  );

  res.json(plans);
});

export default router;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/myalpaca/backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add myalpaca/backend/src/routes/history.ts
git commit -m "feat(backend): add /api/history route joining tradeplans + approvals"
```

---

## Task 7: Backend — mount new routes in index.ts

**Files:**
- Modify: `myalpaca/backend/src/index.ts`

- [ ] **Step 1: Update `myalpaca/backend/src/index.ts`**

Replace the full file content with:

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import healthRouter from './routes/health';
import accountRouter from './routes/account';
import tradeRouter from './routes/trade';
import wheelRouter from './routes/wheel';
import optionsRouter from './routes/options';
import intelRouter from './routes/intel';
import approvalsRouter from './routes/approvals';
import agentsRouter from './routes/agents';
import historyRouter from './routes/history';

const app = express();
const PORT = process.env.PORT || 3001;

// ensure logs directory exists
fs.mkdirSync('/app/logs', { recursive: true });

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/account', accountRouter);
app.use('/api/trade', tradeRouter);
app.use('/api/wheel', wheelRouter);
app.use('/api/options', optionsRouter);
app.use('/api/intel',   intelRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/history', historyRouter);

app.listen(PORT, () => {
  console.log(`Alpaca Trader API running on http://localhost:${PORT}`);
  console.log('Routes: /api/health, /api/account, /api/trade, /api/wheel, /api/options, /api/intel, /api/agents, /api/history');
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader/myalpaca/backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add myalpaca/backend/src/index.ts
git commit -m "feat(backend): mount /api/agents and /api/history routes"
```

---

## Task 8: Frontend — Agents page

**Files:**
- Create: `myalpaca/frontend/src/pages/Agents.tsx`

- [ ] **Step 1: Create `myalpaca/frontend/src/pages/Agents.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';

interface AgentStatus {
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  strategyReady?: boolean;
}

function fmt(isoStr: string | null, opts: Intl.DateTimeFormatOptions): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('en-US', opts);
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
};

const SHORT_OPTS: Intl.DateTimeFormatOptions = {
  month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
};

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface AgentCardProps {
  agentId: 'a' | 'b' | 'c';
  name: string;
  model: string;
  showLogs?: boolean;
}

function AgentCard({ agentId, name, model, showLogs = false }: AgentCardProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => {
      clearInterval(id);
      esRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function fetchStatus() {
    try {
      const r = await fetch(`/api/agents/${agentId}/status`);
      const data: AgentStatus = await r.json();
      setStatus(data);
      if (data.running && !running) startStreaming();
    } catch {
      // backend unreachable
    }
  }

  function startStreaming() {
    setRunning(true);
    setLogs([]);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)),
      1000
    );
    const es = new EventSource(`/api/agents/${agentId}/logs`);
    esRef.current = es;
    es.onmessage = (e) => {
      const line: string = JSON.parse(e.data);
      if (line === '__done__') {
        es.close();
        esRef.current = null;
        setRunning(false);
        if (timerRef.current) clearInterval(timerRef.current);
        fetchStatus();
        return;
      }
      setLogs(prev => [...prev, line]);
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }

  async function handleRunNow() {
    if (running) return;
    try {
      await fetch(`/api/agents/${agentId}/trigger`, { method: 'POST' });
    } catch {
      return;
    }
    if (showLogs) {
      startStreaming();
    } else {
      setTriggered(true);
      setTimeout(() => setTriggered(false), 6_000);
      fetchStatus();
    }
  }

  const isC = agentId === 'c';
  const canRun = isC ? (status?.strategyReady ?? false) : true;
  const disabledReason = isC && !canRun ? 'Run Agent A and B first' : undefined;

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded p-4 space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-white font-semibold">{name}</span>
          <span className="text-[#8B949E] text-xs ml-2 font-mono">{model}</span>
        </div>
        {isC && status && (
          <span className={`text-xs px-2 py-0.5 rounded font-mono ${
            status.strategyReady
              ? 'bg-green-900/40 text-green-400'
              : 'bg-yellow-900/40 text-yellow-400'
          }`}>
            {status.strategyReady ? 'Ready to run' : 'Waiting for strategies'}
          </span>
        )}
      </div>

      <div className="text-xs text-[#8B949E] font-mono space-y-0.5">
        <div>Last run: <span className="text-white">{fmt(status?.lastRun ?? null, SHORT_OPTS)}</span></div>
        {!isC && (
          <div>Next scheduled: <span className="text-white">{fmt(status?.nextRun ?? null, DATE_OPTS)}</span></div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleRunNow}
          disabled={running || !canRun}
          title={disabledReason}
          className={`text-sm px-3 py-1.5 rounded font-mono transition-colors ${
            running || !canRun
              ? 'bg-[#21262D] text-[#8B949E] cursor-not-allowed'
              : 'bg-[#1F6FEB] text-white hover:bg-[#388BFD]'
          }`}
        >
          {running ? 'Running…' : isC ? 'Run Agent C' : 'Run Now'}
        </button>
        {running && (
          <span className="text-yellow-400 text-xs font-mono">⟳ {fmtElapsed(elapsed)}</span>
        )}
        {triggered && (
          <span className="text-green-400 text-xs font-mono">
            ✓ Triggered — check Approvals page
          </span>
        )}
      </div>

      {showLogs && (running || logs.length > 0) && (
        <div className="mt-1">
          <div className="text-xs text-[#8B949E] mb-1 font-mono">
            {running ? `Running — ${fmtElapsed(elapsed)}` : 'Completed'}
          </div>
          <div className="bg-[#010409] border border-[#30363D] rounded p-3 h-52 overflow-y-auto font-mono text-xs text-green-400 space-y-px">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Research Agents</h1>
      <div className="space-y-4">
        <AgentCard agentId="a" name="Agent A" model="Claude Sonnet" showLogs />
        <AgentCard agentId="b" name="Agent B" model="GPT-4o-mini" showLogs />
        <AgentCard agentId="c" name="Agent C" model="Execution" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add myalpaca/frontend/src/pages/Agents.tsx
git commit -m "feat(frontend): add Agents page with schedule, Run Now, live log panel"
```

---

## Task 9: Frontend — History page

**Files:**
- Create: `myalpaca/frontend/src/pages/History.tsx`

- [ ] **Step 1: Create `myalpaca/frontend/src/pages/History.tsx`**

```tsx
import React, { useEffect, useState } from 'react';

interface Trade {
  symbol: string;
  side: 'buy' | 'sell';
  notional: number;
  risk_level: 'low' | 'medium' | 'high';
  source_agreement: 'BOTH' | 'CLAUDE_ONLY' | 'GPT_ONLY';
}

interface HistoryEntry {
  plan_id: string;
  date: string;
  strategy_agreement_score: number;
  trades: Trade[];
  total_notional: number;
  agent_reasoning: string;
  key_disagreements: string[];
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-900/40 text-green-400',
  REJECTED: 'bg-red-900/40 text-red-400',
  EXPIRED:  'bg-[#21262D] text-[#8B949E]',
  PENDING:  'bg-yellow-900/40 text-yellow-400',
};

const RISK_COLOR: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};

function AgreementPct({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono text-sm ${color}`}>{pct}%</span>;
}

function ExpandedRow({ entry }: { entry: HistoryEntry }) {
  const [showFull, setShowFull] = useState(false);
  const reasoning = entry.agent_reasoning ?? '';
  const truncated = reasoning.length > 300;
  const display = showFull ? reasoning : reasoning.slice(0, 300);

  return (
    <tr>
      <td colSpan={5} className="px-4 py-4 bg-[#0D1117] border-b border-[#30363D]">
        <div className="space-y-4 max-w-4xl">

          <div>
            <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">
              Synthesis Reasoning
            </div>
            <p className="text-sm text-[#E6EDF3] font-mono leading-relaxed">
              {display}
              {truncated && !showFull && (
                <button
                  onClick={() => setShowFull(true)}
                  className="text-blue-400 ml-1 hover:underline"
                >
                  …show more
                </button>
              )}
            </p>
          </div>

          {entry.key_disagreements?.length > 0 && (
            <div>
              <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">
                Key Disagreements
              </div>
              <ul className="space-y-1">
                {entry.key_disagreements.map((d, i) => (
                  <li key={i} className="text-sm text-yellow-400 font-mono">⚡ {d}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-2">
              Trade Breakdown
            </div>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="text-[#8B949E] border-b border-[#30363D]">
                  <th className="text-left py-1 pr-4">Symbol</th>
                  <th className="text-left py-1 pr-4">Side</th>
                  <th className="text-right py-1 pr-4">Notional</th>
                  <th className="text-left py-1 pr-4">Risk</th>
                  <th className="text-left py-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {entry.trades.map((t, i) => (
                  <tr key={i} className="border-b border-[#21262D]">
                    <td className="py-1 pr-4 text-white">{t.symbol}</td>
                    <td className={`py-1 pr-4 ${t.side === 'buy' ? 'text-blue-400' : 'text-red-400'}`}>
                      {t.side.toUpperCase()}
                    </td>
                    <td className="py-1 pr-4 text-right text-white">
                      ${t.notional.toLocaleString()}
                    </td>
                    <td className={`py-1 pr-4 ${RISK_COLOR[t.risk_level] ?? ''}`}>
                      {t.risk_level}
                    </td>
                    <td className="py-1 text-[#8B949E]">{t.source_agreement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {entry.rejectionReason && (
            <div>
              <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">
                Rejection Reason
              </div>
              <p className="text-sm text-red-400 font-mono">{entry.rejectionReason}</p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function History() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-[#8B949E] font-mono text-sm mt-8">Loading history…</div>;
  }

  if (history.length === 0) {
    return (
      <div className="mt-8 text-[#8B949E] font-mono text-sm">
        No execution history yet — run Agent C to generate the first trade plan.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Execution History</h1>
      <div className="border border-[#30363D] rounded overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#30363D] bg-[#161B22] text-[#8B949E] text-xs uppercase">
              <th className="text-left py-2 px-4">Date</th>
              <th className="text-left py-2 px-4">Agreement</th>
              <th className="text-left py-2 px-4">Tickers</th>
              <th className="text-right py-2 px-4">Total</th>
              <th className="text-left py-2 px-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map(entry => (
              <React.Fragment key={entry.plan_id}>
                <tr
                  onClick={() => setExpanded(expanded === entry.plan_id ? null : entry.plan_id)}
                  className="border-b border-[#21262D] cursor-pointer hover:bg-[#161B22] transition-colors"
                >
                  <td className="py-2 px-4 font-mono text-white">{entry.date}</td>
                  <td className="py-2 px-4">
                    <AgreementPct score={entry.strategy_agreement_score} />
                  </td>
                  <td className="py-2 px-4 font-mono text-sm">
                    {entry.trades.map((t, i) => (
                      <span key={i}>
                        <span className={t.side === 'buy' ? 'text-blue-400' : 'text-red-400'}>
                          {t.symbol}
                        </span>
                        {i < entry.trades.length - 1 && (
                          <span className="text-[#30363D]"> · </span>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 px-4 font-mono text-white text-right">
                    ${entry.total_notional.toLocaleString()}
                  </td>
                  <td className="py-2 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded font-mono ${STATUS_STYLES[entry.approvalStatus] ?? ''}`}>
                      {entry.approvalStatus}
                    </span>
                  </td>
                </tr>
                {expanded === entry.plan_id && <ExpandedRow entry={entry} />}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add myalpaca/frontend/src/pages/History.tsx
git commit -m "feat(frontend): add History page with expandable trade plan table"
```

---

## Task 10: Frontend — add nav links and routes in App.tsx

**Files:**
- Modify: `myalpaca/frontend/src/App.tsx`

- [ ] **Step 1: Replace `myalpaca/frontend/src/App.tsx`**

```tsx
import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Trade from './pages/Trade';
import Approvals from './pages/Approvals';
import Agents from './pages/Agents';
import History from './pages/History';

function App() {
  return (
    <div className="min-h-screen bg-[#0D1117]">
      <nav className="border-b border-[#30363D] px-6 py-3 flex items-center gap-6">
        <span className="font-mono font-semibold text-white tracking-tight">
          Alpaca Trader
        </span>
        <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded font-mono">
          PAPER
        </span>
        <div className="flex gap-4 ml-4">
          {[
            { to: '/',        label: 'Dashboard' },
            { to: '/trade',   label: 'Trade'     },
            { to: '/approvals', label: 'Approvals' },
            { to: '/agents',  label: 'Agents'    },
            { to: '/history', label: 'History'   },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `text-sm ${isActive ? 'text-white' : 'text-[#8B949E] hover:text-white'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/trade"     element={<Trade />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/agents"    element={<Agents />} />
          <Route path="/history"   element={<History />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Commit**

```bash
git add myalpaca/frontend/src/App.tsx
git commit -m "feat(frontend): add Agents and History nav links and routes"
```

---

## Task 11: Rebuild and smoke test

- [ ] **Step 1: Rebuild all containers**

```bash
cd /Users/bobadillachristian/CodeLab/alpaca-agent-trader
docker compose up -d --build
```

Expected: all 6 containers start without error.

- [ ] **Step 2: Verify agent Flask servers are reachable**

```bash
docker exec agent-a curl -s http://localhost:5001/status
docker exec agent-b curl -s http://localhost:5002/status
docker exec agent-c curl -s http://localhost:5003/status
```

Expected for each:
```json
{"lastRun": null, "running": false}
```

- [ ] **Step 3: Verify backend agent routes**

```bash
curl -s http://localhost:3001/api/agents/a/status | jq .
```

Expected:
```json
{
  "running": false,
  "lastRun": null,
  "nextRun": "<ISO date string>"
}
```

- [ ] **Step 4: Verify backend history route**

```bash
curl -s http://localhost:3001/api/history | jq .
```

Expected: `[]` (empty array — no trade plans yet) or an array of plan objects if data exists.

- [ ] **Step 5: Verify frontend pages load**

Open http://localhost:5173/agents — should show 3 agent cards with schedule info and Run Now buttons.

Open http://localhost:5173/history — should show empty state or table.

- [ ] **Step 6: Smoke test Run Now on Agent A**

Click "Run Now" on Agent A. Verify:
- Button disables and shows "Running…"
- Timer appears
- Log lines stream into the dark panel
- On completion: button re-enables, "Completed" label appears under log panel

- [ ] **Step 7: Commit smoke test confirmation**

```bash
git commit --allow-empty -m "chore: smoke test passed — agents + history pages working"
```
