"""
agent-c/server.py
-----------------
Flask HTTP server for manual triggering of agent-c's daily execution workflow.
No SSE — the run is long-running (up to 2h) and async.

Endpoints:
  GET  /status  — {"running": bool, "lastRun": ISO8601|null, "phase": str|null,
                   "plan_id": str|null, "phase_updated_at": ISO8601|null, "last_error": str|null}
  POST /trigger — 200 {"status":"started"} | 409 {"status":"already_running"}
"""

import asyncio
import glob
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify

app = Flask(__name__)

_running = False
_lock = threading.Lock()

_TRADEPLANS_DIR = os.environ.get("TRADEPLANS_DIR", "/data/tradeplans")
_PHASE_FILE = Path("/tmp/agent-c.phase")


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
