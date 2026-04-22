# Event Log, Tracing & Error Visibility Design

**Date:** 2026-04-22  
**Status:** Approved  
**Scope:** All three agents (A, B, C), approval-bridge, Node.js backend, React frontend

---

## Problem

1. **Agent C appears to hang** — it blocks for up to 120 minutes inside `poll_until_decided()` with no visible phase in the UI. The Agents page shows "Running" with no context.
2. **APPROVE button missing** — on the Approvals page, only the REJECT button renders for pending plans. Root cause: likely `overflow-hidden` on the card container clipping the green APPROVE button, combined with a flex layout issue.
3. **Errors are invisible** — all agent errors go to stdout only. The UI has no error state, so the user has no way to know what failed or why.
4. **No retry path** — expired or rejected plans have no way to be re-run from the UI without manually triggering a full Agent C restart.
5. **No audit trail** — there is no persistent record of what each agent did, when, or what decisions were made.

---

## Approach: File-based Event Log + SSE

Consistent with the existing Docker volume + JSON file architecture. No new infrastructure dependencies.

---

## Section 1 — Event Schema & Storage

### Storage location
All events write to `/data/events/` (shared Docker volume, same as `/data/approvals` and `/data/tradeplans`).

### File naming
```
{ISO_timestamp}_{agent}_{event_type}_{short_id}.json
```
Example: `2026-04-22T14-03-22Z_agent-c_agent_phase_a1b2.json`

Lexicographic sort = chronological order. No database needed.

### Event envelope (all events)
```json
{
  "id": "uuid4",
  "timestamp": "2026-04-22T14:03:22.000Z",
  "agent": "agent-c",
  "event_type": "agent_phase",
  "level": "INFO",
  "plan_id": "uuid4-or-null",
  "phase": "awaiting_approval",
  "message": "Trade plan submitted, polling for decision",
  "metadata": {}
}
```

### Event types

| `event_type`     | Level        | Emitted when |
|------------------|--------------|--------------|
| `agent_phase`    | INFO         | Agent moves to a new execution phase |
| `agent_error`    | ERROR        | Any caught exception or abort condition |
| `plan_submitted` | INFO         | Agent C submits plan to approval bridge |
| `plan_decision`  | INFO / WARN  | Plan reaches APPROVED / REJECTED / EXPIRED / TIMEOUT |
| `trade_executed` | INFO         | A single trade order succeeds |
| `trade_failed`   | ERROR        | A single trade order fails |

### Agent phases

**Agent C:**
```
idle → waiting_strategies → building_plan → awaiting_approval → executing → complete
```
Any step can transition to `error`.

**Agents A & B:**
```
idle → researching → complete
```
Retry attempts emit additional `agent_phase` events with `phase: "retrying"` and retry count in metadata.

---

## Section 2 — Agent Instrumentation

### Shared `EventLogger` class
New file: `shared/event_logger.py`, copied into each agent container at Docker build time via a `COPY shared/ /app/shared/` step in each Dockerfile.

```python
class EventLogger:
    def __init__(self, agent: str, events_dir: str = "/data/events"): ...

    def phase(self, phase: str, plan_id: str | None = None, message: str = "", metadata: dict = {}): ...
    def error(self, message: str, plan_id: str | None = None, metadata: dict = {}): ...
    def event(self, event_type: str, level: str = "INFO", plan_id: str | None = None, message: str = "", metadata: dict = {}): ...
```

`EventLogger` never raises. If a write fails, it logs to stdout and continues. It must never interrupt agent execution.

### Phase file (live status)
Each agent writes a small phase file to `/tmp/{agent}.phase`:
```json
{ "phase": "awaiting_approval", "plan_id": "abc-123", "updated_at": "2026-04-22T14:03:22Z" }
```
Written synchronously before each phase transition. The backend reads this file for real-time status (same pattern as existing heartbeat files).

Phase files: `/tmp/agent-a.phase`, `/tmp/agent-b.phase`, `/tmp/agent-c.phase`

### Instrumentation points

**Agent C (`main.py`)** — emit `agent_phase` at each of the 10 existing steps:
1. `idle` — on startup
2. `waiting_strategies` — before the strategy poll loop
3. `building_plan` — before `build_trade_plan()`
4. `awaiting_approval` — before `poll_until_decided()` (this is the "hang" — now visible)
5. `executing` — before `execute_plan()`
6. `complete` — on successful finish
7. `error` — on any abort/exception

Also emit `plan_submitted` after step 7, `plan_decision` after step 8, `trade_executed` / `trade_failed` per trade in executor.

**Agents A & B** — emit `agent_phase` at:
- `idle` on startup
- `researching` when Claude/GPT call begins
- `retrying` on each retry attempt (metadata: `{attempt: 2, max: 3}`)
- `complete` on success
- `error` on final failure

---

## Section 3 — Backend API

All new endpoints added to the existing Node.js backend (`myalpaca/backend/src/`).

### New routes

**`GET /api/events`**
- Reads `/data/events/`, sorts files lexicographically (newest first), parses JSON
- Query params: `?agent=agent-c&level=ERROR&limit=200`
- Default limit: 200 events
- Returns JSON array of event objects

**`GET /api/events/stream`**
- SSE endpoint, polls `/data/events/` every 3 seconds for files newer than the last-seen timestamp
- Pushes new events as `data: {...}\n\n`
- Same pattern as existing agent log SSE in `agent-a/server.py`

**Enhanced `GET /api/agents/:id/status`**
Currently returns: `{running, lastRun, nextRun, strategyReady}`  
Extended to return:
```json
{
  "running": true,
  "phase": "awaiting_approval",
  "plan_id": "abc-123",
  "phase_updated_at": "2026-04-22T14:03:22Z",
  "last_error": { "message": "...", "timestamp": "..." },
  "lastRun": "...",
  "nextRun": "..."
}
```
Reads the phase file for `phase` / `plan_id` / `phase_updated_at`.  
Reads the most recent `agent_error` event file for `last_error`.

**`GET /api/approvals/all`** (new)
- Backend reads `/data/approvals/*.json` directly (same pattern as `history.ts`) and returns all records sorted newest-first
- Does NOT proxy to approval-bridge; no new bridge endpoint needed
- Used by the retry UI to surface expired/rejected plans with a Re-run button

### Unchanged
`POST /api/agents/agent-c/run-now` — already exists, used by the Retry button. No changes needed.

---

## Section 4 — Frontend

### Agents page
Replace the binary Running/Idle indicator with a phase timeline per agent:

```
agent-c  [●] awaiting_approval  "Waiting for your decision on plan abc-123"  14:03
         Last error: none
```

- Phase dot colors: green = complete, yellow = in-progress phases, red = error
- When `phase = error`: red inline banner with error message + "Run Now" retry button
- Poll `/api/agents/:id/status` every 10 seconds (down from 30)

### Approvals page — bug fixes
1. **APPROVE button fix**: Remove `overflow-hidden` from the card container (`bg-[#161B22]` div). Add `flex-wrap: wrap` and `min-width: 0` safety to the action button row to prevent clipping.
2. **Decision error display**: If the `/decide` POST returns an error, show an inline red banner on that plan card. Currently errors are silently swallowed.
3. **Retry button**: Non-pending plans (REJECTED, EXPIRED) show a "Re-run Agent C" button that calls `POST /api/agents/agent-c/run-now`.

### New "Logs" page
Added to nav: `Dashboard · Trade · Approvals · Agents · Logs · History`

**Table columns:** Timestamp · Agent · Type · Level · Message  
**Expandable row:** full metadata JSON  
**Filter bar:** agent dropdown · level filter (ALL / INFO / WARN / ERROR) · date range  
**Live toggle:** when enabled, SSE stream auto-prepends new rows at top with a subtle flash animation  
**Row styling:**
- ERROR rows: red-tinted background
- Phase transitions: muted gray
- Trade events: green (executed) / orange (failed)
- Plan decisions: highlighted border

### Nav update
Add "Logs" between Agents and History in `App.tsx` and the nav component.

---

## Out of Scope

- SQLite or any database (can be added later if filtering needs improve)
- Log rotation / archiving (events dir will grow; can add a cleanup cron later)
- Authentication on the events API (same trust model as existing endpoints)
- Changing Agent C's synchronous polling architecture (the phase file makes it visible; architectural change is a separate initiative)

---

## Files Changed

| File | Change |
|------|--------|
| `shared/event_logger.py` | New — shared EventLogger class |
| `agent-a/agent.py` | Add phase + error events |
| `agent-b/agent.py` | Add phase + error events |
| `agent-c/main.py` | Add phase events at all 10 steps |
| `agent-c/executor.py` | Add trade_executed / trade_failed events |
| `myalpaca/backend/src/routes/events.ts` | New — GET /api/events + SSE stream |
| `myalpaca/backend/src/routes/agents.ts` | Enhance status to include phase + last_error |
| `myalpaca/backend/src/routes/approvals.ts` | Add GET /all proxy route |
| `myalpaca/backend/src/index.ts` | Register new events route |
| `myalpaca/frontend/src/pages/Agents.tsx` | Phase timeline, error banner, retry |
| `myalpaca/frontend/src/pages/Approvals.tsx` | APPROVE fix, error display, retry button |
| `myalpaca/frontend/src/pages/Logs.tsx` | New — audit log page |
| `myalpaca/frontend/src/App.tsx` | Add Logs route + nav link |
| `docker-compose.yml` | Mount `/data/events` volume into all agent containers |
