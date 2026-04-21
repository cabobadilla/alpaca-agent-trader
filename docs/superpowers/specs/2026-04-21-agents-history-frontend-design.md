# Agents Page + History Page — Frontend Design

**Date:** 2026-04-21
**Scope:** Two new frontend pages — agent schedule/trigger panel and execution history table

---

## Summary

Add two new pages to the myalpaca frontend:

1. **Agents** (`/agents`) — shows each agent's schedule, last run, and a "Run Now" button for Agent A and B with live log streaming. Agent C is manual-only with a conditional trigger.
2. **History** (`/history`) — compact sortable table of all Agent C runs with expandable rows showing agent reasoning, trade breakdown, and approval outcome.

---

## Architecture

### New Flask servers (agent containers)

Each agent container gets a small embedded Flask HTTP server running on a fixed internal port:

| Container | Port | Endpoints |
|-----------|------|-----------|
| agent-a | 5001 | `POST /trigger`, `GET /logs` (SSE) |
| agent-b | 5002 | `POST /trigger`, `GET /logs` (SSE) |
| agent-c | 5003 | `POST /trigger` (no SSE — long-running async) |

- `POST /trigger` — spawns the agent's research/execution run in a background thread; returns `{"status": "started"}` immediately (409 if already running)
- `GET /logs` (A+B only) — SSE endpoint that streams log lines as `data: <line>\n\n` while a run is active; sends `data: __done__\n\n` on completion

### New myalpaca-backend routes (Node.js/Express)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/:agent/trigger` | Proxy to agent Flask `/trigger` |
| GET | `/api/agents/:agent/logs` | Proxy SSE stream from agent Flask `/logs` |
| GET | `/api/agents/:agent/status` | Returns `{ lastRun, nextRun, running, strategyReady }` |
| GET | `/api/history` | Reads `/data/tradeplans/*.json`, joins approval records, returns sorted array |

`/api/agents/:agent/status` computes `nextRun` server-side from the agent's cron expression env var.
`strategyReady` on agent-c status is `true` when both `strategy_claude_YYYY-WW.md` and `strategy_gpt_YYYY-WW.md` exist for the current ISO week.

### New frontend pages

- `myalpaca/frontend/src/pages/Agents.tsx`
- `myalpaca/frontend/src/pages/History.tsx`
- Nav updated in `App.tsx` to include both pages

---

## Agents Page (`/agents`)

### Agent A and Agent B cards (identical)

- **Header:** Agent name + model label (e.g., "Agent A — Claude Sonnet")
- **Last run:** timestamp of most recent completed run (`—` if never)
- **Next run:** computed from cron expression, formatted as e.g. "Mon Apr 28 · 6:00 AM"
- **Run Now button:**
  - Default: enabled, primary blue
  - While running: disabled, label "Running…"
  - On click: button disables, opens log panel, connects `EventSource` to `/api/agents/:agent/logs`
  - On `__done__` event: button re-enables, last run timestamp updates, log panel stays visible
  - If already running on page load: status endpoint returns `running: true` → log panel opens immediately reconnecting to SSE
- **Log panel:** dark terminal box (`#010409` background, monospace, green text), streams lines as received, auto-scrolls, shows elapsed time (`hh:mm:ss`) in panel header

### Agent C card

- **Header:** "Agent C — Execution"
- **Last run:** timestamp of most recent run
- **Status badge:**
  - "Ready to run" (green) — when `strategyReady: true`
  - "Waiting for strategies" (orange) — when `strategyReady: false`
- **Run Agent C button:**
  - Enabled only when `strategyReady: true`
  - Disabled with tooltip "Run Agent A and B first" otherwise
  - On click: calls `POST /api/agents/c/trigger`, shows toast "Agent C triggered — check Approvals for the plan"
  - No log panel (Agent C waits up to 2h for approval; not suitable for streaming)

### Status polling

Page polls `/api/agents/:agent/status` every 30 seconds for all three agents to keep last run / next run / ready state current without a manual refresh.

---

## History Page (`/history`)

### Table

Columns: **Date · Agreement · Tickers · Total · Status**

- **Date** — from `tradeplan.date` (YYYY-MM-DD)
- **Agreement** — `strategy_agreement_score × 100`%, color-coded: green ≥70%, orange 50–69%, red <50%
- **Tickers** — trade symbols joined with ` · `, buys in blue, sells in red
- **Total** — `total_notional` formatted as `$13,000`
- **Status** — badge from joined approval record: `APPROVED` (green) / `REJECTED` (red) / `EXPIRED` (gray) / `PENDING` (yellow, approval record not yet resolved)

Default sort: newest date first.

### Expanded row

Clicking a row toggles an inline detail panel:

- **Synthesis reasoning** — `agent_reasoning` field (Agent C's Claude synthesis of both strategies), truncated to ~300 chars with a "show more" toggle
- **Key disagreements** — `key_disagreements` list, bullet points; omitted if list is empty
- **Trade breakdown table** — symbol · side · notional · risk level · source agreement (BOTH / CLAUDE\_ONLY / GPT\_ONLY)
- **Rejection reason** — shown only if status is REJECTED

### Empty state

"No execution history yet — run Agent C to generate the first trade plan."

---

## Data Flow

### Run Now (A/B)

```
User clicks Run Now
  → POST /api/agents/a/trigger
  → agent-a Flask POST /trigger
  → background thread starts run()
  ← 200 {"status":"started"}
  → EventSource /api/agents/a/logs
  → backend proxies SSE from agent-a Flask GET /logs
  → log lines stream into UI panel
  → agent sends data: __done__
  → button re-enables, last run updates
```

### History load

```
Page mounts
  → GET /api/history
  → backend reads /data/tradeplans/tradeplan_*.json (sorted by date desc)
  → for each plan: reads /data/approvals/{plan_id}.json (if exists)
  → merges status field from approval record
  ← array of enriched plan objects
  → rendered as table
```

---

## Out of Scope

- Filtering or searching history
- Cancelling a running agent mid-flight
- Agent C log streaming (too long-running for SSE in this iteration)
- Editing cron schedules from the UI
