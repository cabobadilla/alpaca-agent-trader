# Alpaca Agent Trader — Architecture Document
**Dark Software Factory | Version 1.0 | 2026-04-20**

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          DOCKER COMPOSE NETWORK: alpaca-net                         │
│                                                                                     │
│  ┌──────────────────────────┐      ┌──────────────────────────┐                    │
│  │   AGENT A                │      │   AGENT B                │                    │
│  │   Claude Research        │      │   GPT Research           │                    │
│  │   (Python / cron)        │      │   (Python / cron)        │                    │
│  │   Claude Sonnet 4.6      │      │   GPT-4o-mini            │                    │
│  │   Every Sunday 10pm      │      │   Every Sunday 10pm      │                    │
│  └────────────┬─────────────┘      └──────────────┬───────────┘                    │
│               │  writes                            │  writes                        │
│               ▼                                    ▼                                │
│  ┌────────────────────────────────────────────────────────────────────────────┐    │
│  │                    SHARED VOLUME: /data/strategies/                        │    │
│  │   strategy_claude_YYYY-WW.md          strategy_gpt_YYYY-WW.md             │    │
│  └────────────────────────────────────────────┬───────────────────────────────┘    │
│                                               │  reads                              │
│                                               ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐      │
│  │                        AGENT C — Execution Agent                         │      │
│  │                        (Python / cron)                                   │      │
│  │                        Claude Sonnet 4.6                                 │      │
│  │                        Every weekday 8am                                 │      │
│  └────────┬──────────────────────────────────────────────┬──────────────────┘      │
│           │  GET /api/account                            │  POST /approval/submit  │
│           │  GET /api/account/positions                  │                         │
│           │  POST /api/trade/execute (after approval)    ▼                         │
│           ▼                                   ┌──────────────────────────────┐     │
│  ┌────────────────────────┐                   │   APPROVAL BRIDGE            │     │
│  │   myAlpaca API         │                   │   (Python / FastAPI)         │     │
│  │   (Node.js / existing) │                   │   port 8080                  │     │
│  │   port 3001            │                   └──────┬───────────────────────┘     │
│  └────────────────────────┘                          │                             │
│                                                       │  Resend API (HTTPS/ext)    │
│                                                       │  Telegram Bot API (HTTPS/ext)
│                                                       ▼                             │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                                        │
                         ┌──────────────────────────────┤
                         ▼                              ▼
                   📧 Email (Resend)            📱 Telegram Bot
                   Full HTML trade plan         Short summary
                         │                              │
                         └──────────────────────────────┘
                                        │
                                        ▼
                                   👤 USER
                                   Replies: APPROVE / REJECT
                                        │
                                        ▼
                            Telegram → Approval Bridge
                            Bridge signals Agent C
                            Agent C executes trades
                            Confirmation via Telegram + Email
```

**External Dependencies (egress only from Docker host):**
- `api.anthropic.com` — Agent A + C model calls
- `api.openai.com` — Agent B model calls
- `api.resend.com` — email delivery
- `api.telegram.org` — Telegram Bot API
- `paper-api.alpaca.markets` — via myAlpaca container

---

## 2. Tech Stack Table

| Service | Language | Framework/Runtime | Key Libraries | Purpose |
|---|---|---|---|---|
| `agent-a` | Python 3.12 | APScheduler + asyncio | `anthropic`, `httpx` | Claude weekly research agent |
| `agent-b` | Python 3.12 | APScheduler + asyncio | `openai`, `httpx` | GPT weekly research agent |
| `agent-c` | Python 3.12 | APScheduler + asyncio | `anthropic`, `httpx` | Daily execution + trade orchestration |
| `approval-bridge` | Python 3.12 | FastAPI + Uvicorn | `python-telegram-bot`, `resend`, `asyncio` | Approval state machine + comms hub |
| `myalpaca` | Node.js / TypeScript | Express (existing) | — | Alpaca API connector (DO NOT MODIFY) |

**Shared Infrastructure:**
| Component | Technology | Notes |
|---|---|---|
| Container orchestration | Docker Compose v2 | Single `docker-compose.yml` at repo root |
| Inter-service network | Docker bridge `alpaca-net` | Internal DNS by service name |
| Persistent storage | Docker named volumes | `strategies-data`, `tradeplan-data`, `approval-data` |
| Secrets | `.env` file + Docker env_file | Never committed to git |
| Scheduling | APScheduler (in-process) | No external scheduler needed |

---

## 3. Container Map

### 3.1 Service Definitions

| Service Name | Image | Internal Port | Host Port | Role |
|---|---|---|---|---|
| `myalpaca` | `myalpaca:local` (existing) | 3001 | 3001 | Alpaca connector (reference only) |
| `agent-a` | `alpaca-agent-a:local` | — (no HTTP) | — | Claude research cron |
| `agent-b` | `alpaca-agent-b:local` | — (no HTTP) | — | GPT research cron |
| `agent-c` | `alpaca-agent-c:local` | — (no HTTP) | — | Execution cron |
| `approval-bridge` | `alpaca-bridge:local` | 8080 | 8080 | FastAPI approval hub |

### 3.2 Volumes

| Volume Name | Mounted At | Used By | Contents |
|---|---|---|---|
| `strategies-data` | `/data/strategies` | agent-a, agent-b, agent-c | Weekly markdown strategy docs |
| `tradeplan-data` | `/data/tradeplans` | agent-c, approval-bridge | Daily trade plan JSON files |
| `approval-data` | `/data/approvals` | agent-c, approval-bridge | Approval state JSON files |

### 3.3 Environment Variables Per Service

#### `agent-a` (Claude Research)
```
ANTHROPIC_API_KEY=
STRATEGIES_DIR=/data/strategies
LOG_LEVEL=INFO
AGENT_A_CRON=0 22 * * 0        # Sunday 10pm
```

#### `agent-b` (GPT Research)
```
OPENAI_API_KEY=
STRATEGIES_DIR=/data/strategies
LOG_LEVEL=INFO
AGENT_B_CRON=0 22 * * 0        # Sunday 10pm
```

#### `agent-c` (Execution Agent)
```
ANTHROPIC_API_KEY=
STRATEGIES_DIR=/data/strategies
TRADEPLANS_DIR=/data/tradeplans
APPROVALS_DIR=/data/approvals
MYALPACA_BASE_URL=http://myalpaca:3001
APPROVAL_BRIDGE_URL=http://approval-bridge:8080
AGENT_C_CRON=0 8 * * 1-5       # Mon-Fri 8am
APPROVAL_TIMEOUT_MINUTES=60
LOG_LEVEL=INFO
```

#### `approval-bridge` (FastAPI)
```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_TO_EMAIL=
TRADEPLANS_DIR=/data/tradeplans
APPROVALS_DIR=/data/approvals
BRIDGE_PORT=8080
LOG_LEVEL=INFO
```

### 3.4 Health Checks

| Service | Health Check Command | Interval | Timeout | Retries |
|---|---|---|---|---|
| `myalpaca` | `curl -f http://localhost:3001/api/health` | 30s | 10s | 3 |
| `approval-bridge` | `curl -f http://localhost:8080/health` | 30s | 10s | 3 |
| `agent-a` | `test -f /tmp/agent-a.heartbeat` | 60s | 5s | 3 |
| `agent-b` | `test -f /tmp/agent-b.heartbeat` | 60s | 5s | 3 |
| `agent-c` | `test -f /tmp/agent-c.heartbeat` | 60s | 5s | 3 |

### 3.5 Service Dependencies (startup order)
```
myalpaca          → (no deps)
approval-bridge   → (no deps)
agent-a           → (no deps)
agent-b           → (no deps)
agent-c           → depends_on: [myalpaca, approval-bridge] (condition: service_healthy)
```

---

## 4. Agent Specifications

### 4.1 Agent A — Claude Research Agent

| Field | Value |
|---|---|
| **Container** | `agent-a` |
| **Trigger** | Cron: `0 22 * * 0` (Every Sunday at 22:00 local) |
| **Model** | `claude-sonnet-4-5` (Anthropic) |
| **Max tokens** | 4096 |
| **Temperature** | 0.3 (factual, low variance) |

**Inputs:**
| Input | Source | Method |
|---|---|---|
| Current date / week number | System | `datetime.now()` |
| Research prompt template | Embedded in agent code | Static system prompt |

**System Prompt (summary):**
> You are a senior US equity research analyst. Your task is to produce a weekly investment strategy document for the coming trading week. Research macro environment, Fed posture, earnings calendar, sector rotation, and momentum. Output STRICT markdown per the WeeklyStrategy schema. Be specific. Cite reasoning.

**Outputs:**
| Output | Format | Location |
|---|---|---|
| Weekly strategy document | Markdown (`.md`) | `/data/strategies/strategy_claude_YYYY-WW.md` |
| Run log | Text | stdout → Docker logs |

**Tools available to Agent A:**
- None (model uses training knowledge + structured prompt; no live web search in v1)
- Note: web search tool can be added in v2 via Anthropic tool use API

---

### 4.2 Agent B — GPT Research Agent

| Field | Value |
|---|---|
| **Container** | `agent-b` |
| **Trigger** | Cron: `0 22 * * 0` (Every Sunday at 22:00 local) |
| **Model** | `gpt-4o-mini` (OpenAI) |
| **Max tokens** | 4096 |
| **Temperature** | 0.3 |

**Inputs:**
| Input | Source | Method |
|---|---|---|
| Current date / week number | System | `datetime.now()` |
| Research prompt template | Embedded in agent code | Static system prompt (identical mission to Agent A) |

**System Prompt (summary):**
> You are a senior US equity research analyst. Produce a weekly investment strategy document for the coming trading week. Research macro environment, Fed posture, earnings calendar, sector rotation, and momentum. Output STRICT markdown per the WeeklyStrategy schema. Be specific. Cite reasoning.

**Outputs:**
| Output | Format | Location |
|---|---|---|
| Weekly strategy document | Markdown (`.md`) | `/data/strategies/strategy_gpt_YYYY-WW.md` |
| Run log | Text | stdout → Docker logs |

**Tools available to Agent B:**
- None (same rationale as Agent A; v2 can add function calling with browsing)

---

### 4.3 Agent C — Execution Agent

| Field | Value |
|---|---|
| **Container** | `agent-c` |
| **Trigger** | Cron: `0 8 * * 1-5` (Mon–Fri at 08:00 local) |
| **Model** | `claude-sonnet-4-5` (Anthropic) |
| **Max tokens** | 8192 |
| **Temperature** | 0.1 (deterministic; financial decisions) |

**Inputs:**
| Input | Source | Method |
|---|---|---|
| Latest Claude strategy doc | `/data/strategies/` | Read most recent `strategy_claude_YYYY-WW.md` |
| Latest GPT strategy doc | `/data/strategies/` | Read most recent `strategy_gpt_YYYY-WW.md` |
| Current portfolio state | myAlpaca `GET /api/account` | HTTP via Docker network |
| Open positions | myAlpaca `GET /api/account/positions` | HTTP via Docker network |
| Recent orders | myAlpaca `GET /api/account/orders` | HTTP via Docker network |
| Current date + market context | System | `datetime.now()` |

**System Prompt (summary):**
> You are a disciplined quantitative portfolio manager. Given two independent weekly research documents and current portfolio state, produce a concrete daily trade plan in strict JSON format. Consider position sizing, portfolio concentration, risk limits, and alignment between the two research views. Flag disagreements. Never exceed 20% portfolio in any single position. Output must conform to the DailyTradePlan schema exactly.

**Outputs:**
| Output | Format | Location | Trigger |
|---|---|---|---|
| Daily trade plan | JSON | `/data/tradeplans/tradeplan_YYYY-MM-DD.json` | Always |
| Approval request | HTTP POST | `approval-bridge:8080/approval/submit` | Always |
| Trade execution calls | HTTP POST | `myalpaca:3001/api/trade/execute` | Only after APPROVE |
| Confirmation notification | HTTP POST | `approval-bridge:8080/notification/send` | After execution |

**Tools available to Agent C:**
| Tool | Type | Description |
|---|---|---|
| `get_account` | HTTP client | `GET myalpaca:3001/api/account` |
| `get_positions` | HTTP client | `GET myalpaca:3001/api/account/positions` |
| `get_orders` | HTTP client | `GET myalpaca:3001/api/account/orders` |
| `execute_trade` | HTTP client | `POST myalpaca:3001/api/trade/execute` |
| `submit_for_approval` | HTTP client | `POST approval-bridge:8080/approval/submit` |
| `poll_approval_status` | HTTP client | `GET approval-bridge:8080/approval/{plan_id}/status` |
| `send_notification` | HTTP client | `POST approval-bridge:8080/notification/send` |
| `read_strategy_file` | File I/O | Read markdown from `/data/strategies/` |
| `write_tradeplan_file` | File I/O | Write JSON to `/data/tradeplans/` |

**Approval Wait Logic:**
```
1. Submit plan → get plan_id
2. Poll GET /approval/{plan_id}/status every 60 seconds
3. If status = APPROVED → execute trades
4. If status = REJECTED → log reason, skip execution, notify user
5. If timeout (APPROVAL_TIMEOUT_MINUTES elapsed) → mark EXPIRED, skip, alert user
```

---

## 5. Data Models

### 5.1 WeeklyStrategy Document (Markdown Schema)

Both Agent A and Agent B output a Markdown file with this exact structure:

```markdown
# Weekly Investment Strategy — Week YYYY-WW
**Generated by:** [Claude Sonnet 4.6 | GPT-4o-mini]
**Generated at:** ISO8601 timestamp
**Week of:** YYYY-MM-DD to YYYY-MM-DD

## Macro Environment
[2-3 paragraphs: Fed posture, inflation, GDP trend, geopolitical flags]

## Sector Momentum
| Sector | Trend | Confidence | Notes |
|--------|-------|------------|-------|
| ...    | ...   | ...        | ...   |

## Earnings Calendar Flags
| Ticker | Report Date | Consensus EPS | Risk Level |
|--------|-------------|---------------|------------|
| ...    | ...         | ...           | ...        |

## Top 5 Ticker Recommendations
| Rank | Ticker | Action | Thesis | Risk Level | Confidence |
|------|--------|--------|--------|------------|------------|
| 1    | ...    | BUY/HOLD/AVOID | ... | LOW/MED/HIGH | 0.0–1.0 |

## Overall Portfolio Risk Level
[LOW | MEDIUM | HIGH | VERY HIGH]

## Key Risks to Watch
- [Risk 1]
- [Risk 2]
- [Risk 3]

## Reasoning Summary
[1 paragraph synthesis]
```

---

### 5.2 DailyTradePlan (JSON Schema)

File: `/data/tradeplans/tradeplan_YYYY-MM-DD.json`

```json
{
  "plan_id": "uuid-v4",
  "date": "YYYY-MM-DD",
  "generated_at": "ISO8601",
  "status": "PENDING | APPROVED | REJECTED | EXPIRED | EXECUTED",
  "agent_model": "claude-sonnet-4-5",
  "strategy_sources": {
    "claude_strategy_file": "strategy_claude_YYYY-WW.md",
    "gpt_strategy_file": "strategy_gpt_YYYY-WW.md",
    "strategy_agreement_score": 0.0,
    "key_disagreements": ["string"]
  },
  "portfolio_snapshot": {
    "equity": 0.0,
    "cash": 0.0,
    "buying_power": 0.0,
    "unrealized_pl": 0.0,
    "positions_count": 0
  },
  "trades": [
    {
      "trade_id": "uuid-v4",
      "symbol": "AAPL",
      "side": "buy | sell",
      "notional": 0.0,
      "rationale": "string",
      "risk_level": "LOW | MEDIUM | HIGH",
      "source_agreement": "BOTH | CLAUDE_ONLY | GPT_ONLY",
      "status": "PENDING | EXECUTED | SKIPPED | FAILED"
    }
  ],
  "total_notional": 0.0,
  "portfolio_pct_deployed": 0.0,
  "risk_summary": "string",
  "agent_reasoning": "string",
  "approval": {
    "requested_at": "ISO8601 | null",
    "decided_at": "ISO8601 | null",
    "decision": "PENDING | APPROVED | REJECTED | EXPIRED",
    "rejection_reason": "string | null",
    "telegram_message_id": "string | null"
  },
  "execution": {
    "executed_at": "ISO8601 | null",
    "trades_executed": 0,
    "trades_failed": 0,
    "execution_log": ["string"]
  }
}
```

---

### 5.3 ApprovalState (JSON Schema)

File: `/data/approvals/approval_{plan_id}.json`

```json
{
  "approval_id": "uuid-v4",
  "plan_id": "uuid-v4",
  "date": "YYYY-MM-DD",
  "state": "AWAITING_SEND | EMAIL_SENT | TELEGRAM_SENT | AWAITING_REPLY | APPROVED | REJECTED | EXPIRED | ERROR",
  "telegram_chat_id": "string",
  "telegram_message_id": "string | null",
  "email_message_id": "string | null",
  "created_at": "ISO8601",
  "email_sent_at": "ISO8601 | null",
  "telegram_sent_at": "ISO8601 | null",
  "reply_received_at": "ISO8601 | null",
  "decision": "APPROVED | REJECTED | null",
  "rejection_reason": "string | null",
  "expires_at": "ISO8601",
  "error_log": ["string"]
}
```

---

## 6. Internal API Contracts — Approval Bridge (FastAPI)

Base URL (internal): `http://approval-bridge:8080`

---

### `GET /health`
**Purpose:** Container health check
**Response 200:**
```json
{ "status": "ok", "timestamp": "ISO8601" }
```

---

### `POST /approval/submit`
**Purpose:** Agent C submits a trade plan for user approval
**Request Body:**
```json
{
  "plan_id": "uuid-v4",
  "date": "YYYY-MM-DD",
  "summary": "Short human-readable summary (≤500 chars)",
  "trades": [
    {
      "symbol": "AAPL",
      "side": "buy",
      "notional": 1000.0,
      "rationale": "string"
    }
  ],
  "total_notional": 0.0,
  "risk_summary": "string",
  "agent_reasoning": "string",
  "strategy_agreement_score": 0.0,
  "key_disagreements": ["string"],
  "portfolio_snapshot": { "equity": 0.0, "cash": 0.0, "buying_power": 0.0 }
}
```
**Response 202:**
```json
{
  "approval_id": "uuid-v4",
  "plan_id": "uuid-v4",
  "expires_at": "ISO8601",
  "message": "Approval request queued"
}
```
**Response 409:** Plan for today already submitted
```json
{ "error": "duplicate_plan", "message": "Trade plan for YYYY-MM-DD already exists" }
```

---

### `GET /approval/{plan_id}/status`
**Purpose:** Agent C polls for decision
**Response 200:**
```json
{
  "plan_id": "uuid-v4",
  "state": "AWAITING_REPLY | APPROVED | REJECTED | EXPIRED | ERROR",
  "decision": "APPROVED | REJECTED | null",
  "rejection_reason": "string | null",
  "decided_at": "ISO8601 | null",
  "expires_at": "ISO8601"
}
```
**Response 404:** Plan not found

---

### `POST /telegram/webhook`
**Purpose:** Receive Telegram Bot API updates (incoming user messages)
**Note:** This endpoint is called by Telegram's servers via long-polling handled by `python-telegram-bot`. Not called by internal services directly.
**Request Body:** Telegram Update object (standard Telegram API format)
**Response 200:** `{ "ok": true }`

---

### `POST /notification/send`
**Purpose:** Agent C triggers a custom notification (e.g., execution confirmation)
**Request Body:**
```json
{
  "plan_id": "uuid-v4",
  "type": "EXECUTION_COMPLETE | EXECUTION_FAILED | PLAN_EXPIRED | CUSTOM",
  "telegram_message": "string",
  "email_subject": "string",
  "email_html": "string"
}
```
**Response 200:**
```json
{
  "telegram_sent": true,
  "email_sent": true,
  "errors": []
}
```

---

### `GET /approval/history`
**Purpose:** List all past approvals (admin/debug)
**Query params:** `?limit=20&offset=0&status=APPROVED`
**Response 200:**
```json
{
  "total": 0,
  "items": [ { "...ApprovalState..." } ]
}
```

---

## 7. Approval Flow Sequence

```
Time    Agent C                    Approval Bridge              User (Telegram + Email)
────    ───────                    ───────────────              ───────────────────────

08:00   [CRON TRIGGER]

08:01   reads strategy_claude_YYYY-WW.md
        reads strategy_gpt_YYYY-WW.md
        GET myalpaca:3001/api/account
        GET myalpaca:3001/api/account/positions
        GET myalpaca:3001/api/account/orders

08:02   [Claude Sonnet 4.6 inference]
        builds DailyTradePlan JSON
        writes /data/tradeplans/tradeplan_YYYY-MM-DD.json

08:03   POST /approval/submit ──────────────────────────────►
                                   creates ApprovalState file
                                   state = AWAITING_SEND
                                   ◄───── 202 {approval_id, expires_at}

08:03                              [Resend API call]
                                   sends HTML email ──────────────────────────────►
                                   (full plan, research context,
                                    APPROVE/REJECT instructions)
                                   state = EMAIL_SENT

08:03                              [Telegram Bot API call]
                                   sends message: ─────────────────────────────────►
                                   "📊 Daily Trade Plan — Mon Apr 20
                                    3 trades | $3,200 notional
                                    Risk: MEDIUM
                                    Reply APPROVE or REJECT"
                                   state = TELEGRAM_SENT / AWAITING_REPLY

08:03   GET /approval/{id}/status ──────────────────────────►
                                   ◄───── { state: "AWAITING_REPLY" }
        (polls every 60s)

08:15                                                          User reads email 📧
                                                               User reads Telegram 📱
                                                               User replies: "APPROVE"

08:15                              [Telegram webhook / poll]
                                   receives "APPROVE" from TELEGRAM_CHAT_ID
                                   validates sender == authorized chat id
                                   state = APPROVED
                                   writes approval decision to ApprovalState

08:16   GET /approval/{id}/status ──────────────────────────►
                                   ◄───── { state: "APPROVED", decision: "APPROVED" }

08:16   [FOR EACH trade in plan]:
        POST myalpaca:3001/api/trade/execute
        { symbol, side, notional }
        ◄───── order confirmation

08:16   updates tradeplan status = EXECUTED
        POST /notification/send ───────────────────────────►
                                   sends Telegram: ──────────────────────────────────►
                                   "✅ Trades executed:
                                    BUY AAPL $1000 ✓
                                    BUY MSFT $800 ✓
                                    SELL TSLA $400 ✓"

                                   sends confirmation email ────────────────────────►
                                   (full execution report)

── REJECTION VARIANT ──

User replies: "REJECT reason: market too volatile"

                                   state = REJECTED
                                   rejection_reason captured

Agent C polls → state REJECTED
Agent C logs rejection, skips all trades
POST /notification/send →
  Telegram: "❌ Trade plan rejected. No trades executed."
  Email: rejection summary

── TIMEOUT VARIANT ──

No reply within APPROVAL_TIMEOUT_MINUTES (default: 60 min)

                                   background job fires
                                   state = EXPIRED

Agent C polls → state EXPIRED
Agent C logs expiry, skips all trades
POST /notification/send →
  Telegram: "⏰ Trade plan expired. No trades executed."
```

---

## 8. File/Folder Structure

```
alpaca-agent-trader/
├── docker-compose.yml              ← Orchestrates all services + references myalpaca
├── .env                            ← ALL secrets (never in git)
├── .env.example                    ← Template with empty values (committed to git)
├── .gitignore                      ← Includes .env, /data/, *.log
├── README.md
│
├── agent-a/                        ← Claude Research Agent
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                     ← Entrypoint, APScheduler setup
│   ├── agent.py                    ← Claude API calls, strategy generation
│   ├── prompts.py                  ← System prompt templates
│   ├── storage.py                  ← File I/O helpers for /data/strategies/
│   └── config.py                   ← Env var loading
│
├── agent-b/                        ← GPT Research Agent
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   ├── agent.py                    ← OpenAI API calls, strategy generation
│   ├── prompts.py
│   ├── storage.py
│   └── config.py
│
├── agent-c/                        ← Execution Agent
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                     ← Entrypoint, APScheduler setup
│   ├── agent.py                    ← Claude API, trade plan generation
│   ├── prompts.py
│   ├── myalpaca_client.py          ← HTTP client for myAlpaca API
│   ├── approval_client.py          ← HTTP client for Approval Bridge
│   ├── executor.py                 ← Trade execution logic + polling loop
│   ├── storage.py                  ← File I/O for /data/strategies/, /data/tradeplans/
│   └── config.py
│
├── approval-bridge/                ← FastAPI Approval Hub
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                     ← FastAPI app entrypoint
│   ├── routers/
│   │   ├── approval.py             ← /approval/* endpoints
│   │   ├── telegram_webhook.py     ← /telegram/webhook endpoint
│   │   └── notification.py        ← /notification/send endpoint
│   ├── services/
│   │   ├── telegram_service.py     ← python-telegram-bot integration
│   │   ├── email_service.py        ← Resend API integration
│   │   └── approval_state.py      ← ApprovalState read/write logic
│   ├── models/
│   │   ├── approval.py             ← Pydantic models (ApprovalState, etc.)
│   │   └── tradeplan.py           ← Pydantic models (DailyTradePlan, etc.)
│   ├── templates/
│   │   └── email_trade_plan.html  ← Jinja2 HTML email template
│   └── config.py
│
├── shared/                         ← Shared Python utilities (optional)
│   └── schemas.py                  ← Common Pydantic models if needed
│
└── data/                           ← Runtime data (created by Docker volumes)
    ├── strategies/                 ← .gitkeep only; actual files in Docker volume
    ├── tradeplans/                 ← .gitkeep only
    └── approvals/                  ← .gitkeep only
```

---

## 9. Security Model

### 9.1 Secret Handling Rules

| Rule | Detail |
|---|---|
| `.env` is **never committed** | Listed in `.gitignore` — this is enforced |
| `.env.example` is committed | Contains only key names, all values empty |
| Secrets passed as env vars only | No hardcoding in any source file |
| No secrets in Docker image layers | `ENV` instructions never used for secret values in Dockerfiles |
| Secrets scoped per service | Agent B never receives `ANTHROPIC_API_KEY`; Agent A never receives `OPENAI_API_KEY` |
| Telegram Chat ID is access control | Only messages from `TELEGRAM_CHAT_ID` trigger approval decisions; all others ignored |

### 9.2 `.env.example` (committed to git)

```bash
# === Anthropic (Agent A + Agent C) ===
ANTHROPIC_API_KEY=

# === OpenAI (Agent B) ===
OPENAI_API_KEY=

# === Alpaca (consumed by myAlpaca — set in myAlpaca's .env, not here) ===
# ALPACA_API_KEY=
# ALPACA_SECRET_KEY=

# === Resend Email ===
RESEND_API_KEY=
RESEND_FROM_EMAIL=trades@yourdomain.com
RESEND_TO_EMAIL=you@yourdomain.com

# === Telegram Bot ===
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# === Agent C Config ===
APPROVAL_TIMEOUT_MINUTES=60

# === Scheduling (cron expressions) ===
AGENT_A_CRON=0 22 * * 0
AGENT_B_CRON=0 22 * * 0
AGENT_C_CRON=0 8 * * 1-5

# === Logging ===
LOG_LEVEL=INFO
```

### 9.3 What Never Goes in Git

```
.env
data/strategies/*.md
data/tradeplans/*.json
data/approvals/*.json
*.log
__pycache__/
.venv/
node_modules/
```

### 9.4 Network Security

| Concern | Mitigation |
|---|---|
| Internal services exposed | `approval-bridge` on host port 8080 is the ONLY service with a host port; agents have NO host ports |
| Inter-service calls | Use Docker internal DNS (`http://service-name:port`) — never `localhost` |
| Telegram bot impersonation | `TELEGRAM_CHAT_ID` env var — all webhook updates checked against this ID; non-matching messages silently ignored |
| Trade execution without approval | Agent C code path: execution only reached if `approval.state == "APPROVED"` — this is a hard gate, not a flag |
| No TLS on internal network | Internal Docker bridge network is trusted; TLS only on external API calls (handled by `httpx` default) |

### 9.5 Alpaca Secret Boundary

The `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` remain **inside the `myalpaca` container only**. The new agent system NEVER holds or transmits Alpaca credentials — it only calls the myAlpaca HTTP API over the internal Docker network. This is the existing security boundary and must not be broken.

---

## 10. Open Questions

The following three decisions are deferred to the user/product owner:

### Q1 — Agent Scheduling Timezone
**DECIDED (2026-04-19):** `TZ=America/New_York` set on ALL containers. All cron expressions map to EST/EDT.

### Q2 — Research Schedule + Retry
**DECIDED (2026-04-19):**
- Agents A+B run **Monday 6am EST** (not Sunday night) — captures weekend news and market futures.
- Cron: `0 6 * * 1`
- Retry: 3 attempts with 15-minute gap between each. After 3 failures → alert email via Resend.
- Agent C cron moves to **Monday 9am EST** (`0 9 * * 1-5`) — gives research agents 3 hours to complete.
- Agent C pre-flight: checks both strategy files exist and are dated today before building plan. If not ready, waits up to 2 hours (polling every 15 min) before aborting with alert.

### Q3 — Approval Mechanism
**DECIDED (2026-04-19):** No Telegram bot. No long polling.
- **Approval flow:** Resend email notifies user plan is ready → user opens **myAlpaca frontend `/approvals` page** → reviews plan → clicks APPROVE or REJECT button → frontend POSTs decision to approval-bridge.
- **Implication:** myAlpaca frontend (React/Vite) gets a new `/approvals` route — new page showing pending trade plans with full detail + approve/reject buttons.
- **Why:** Cleaner UX, no Telegram bot token needed, visible in the existing app the user already runs.

---

*Document end — Architecture v1.0*
*Dark Software Factory | Alpaca Agent Trader*
