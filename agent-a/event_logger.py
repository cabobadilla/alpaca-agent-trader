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
        if phase == "error":
            payload["error_message"] = message  # always set when phase is "error"
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
