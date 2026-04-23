"""
agent-b/server.py
-----------------
Flask HTTP server for on-demand trigger and live log streaming.
Runs in a daemon thread alongside BlockingScheduler.

Endpoints:
  GET  /status  — {"running": bool, "lastRun": ISO8601|null, "phase": str|null,
                   "plan_id": str|null, "phase_updated_at": ISO8601|null, "last_error": str|null}
  POST /trigger — 200 {"status":"started"} | 409 {"status":"already_running"}
  GET  /logs    — SSE stream; sends "__done__" on completion
"""

import glob
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, Response, jsonify

app = Flask(__name__)

_running = False
_lock = threading.Lock()
_log_buf: list[str] = []
_log_cond = threading.Condition(_lock)

_STRATEGIES_DIR = os.environ.get("STRATEGIES_DIR", "/data/strategies")
_STRATEGY_PREFIX = "gpt"
_PHASE_FILE = Path("/tmp/agent-b.phase")


class _SSEHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        with _log_cond:
            _log_buf.append(msg)
            _log_cond.notify_all()


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


@app.route("/trigger", methods=["POST"])
def trigger():
    global _running
    with _lock:
        if _running:
            return jsonify({"status": "already_running"}), 409
        _running = True
        _log_buf.clear()
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"status": "started"}), 200


def trigger_run() -> None:
    """Entry point for scheduler — same guard as POST /trigger."""
    global _running
    with _lock:
        if _running:
            logging.warning("Scheduled run skipped: agent already running")
            return
        _running = True
        _log_buf.clear()
    threading.Thread(target=_run, daemon=True).start()


def _run() -> None:
    global _running
    handler = _SSEHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", datefmt="%H:%M:%S"))
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        from agent import run_research_with_retry
        run_research_with_retry()
    except Exception as exc:
        logging.error("Agent run failed: %s", exc)
    finally:
        root.removeHandler(handler)
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
