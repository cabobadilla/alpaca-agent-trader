# Alpaca Agent Trader

> AI-powered multi-agent investment system — autonomous weekly research + daily trade execution with human approval gate.

## Overview

```
MONDAY 6am EST
  Agent A (Claude Sonnet) ──┐  research + 3 retries if fail
  Agent B (GPT-4o-mini)  ──┘  → /data/strategies/

MONDAY 9am EST (Mon-Fri)
  Agent C (Claude Sonnet)
    reads both strategies
    fetches live portfolio from myAlpaca
    builds DailyTradePlan JSON
    → Resend email: "Plan ready — review at http://localhost:5173/approvals"

YOU open myAlpaca app /approvals page
  Review trades, reasoning, portfolio impact
  Click APPROVE or REJECT

Agent C polls for decision
  → APPROVED: executes trades via myAlpaca API
  → REJECTED/EXPIRED: logs, skips, notifies
  → Confirmation email sent
```

## Prerequisites

- Docker + Docker Compose v2
- myAlpaca running on port 3001 (`cd ../myAlpaca && docker compose up`)
- API keys: Anthropic, OpenAI, Resend

## Quick Start

```bash
git clone https://github.com/cabobadilla/alpaca-agent-trader
cd alpaca-agent-trader
cp .env.example .env
# Edit .env with your API keys
docker compose up --build
```

## Services

| Service | Port | Purpose |
|---|---|---|
| `approval-bridge` | 8080 | FastAPI — trade plan intake, email, approval state |
| `agent-a` | — | Claude Sonnet weekly research (Monday 6am EST) |
| `agent-b` | — | GPT-4o-mini weekly research (Monday 6am EST) |
| `agent-c` | — | Execution agent (Mon-Fri 9am EST) |
| `myalpaca` | 3001 | Alpaca connector (external, pre-existing) |

## Environment Variables

See `.env.example` for full list. Required:
- `ANTHROPIC_API_KEY` — for agent-a and agent-c
- `OPENAI_API_KEY` — for agent-b
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL` + `RESEND_TO_EMAIL` — email notifications
- `MYALPACA_BASE_URL` — defaults to `http://myalpaca:3001`

## Architecture

See `docs/architecture.md` for full system design.

## Security

- `.env` is never committed (in `.gitignore`)
- Alpaca API keys stay inside the myAlpaca container — never exposed to agent system
- All inter-service calls use Docker internal DNS (`http://service-name:port`)
- Paper trading only until system is validated

## Development

```bash
# Run a specific service
docker compose up agent-a --build

# Tail logs
docker compose logs -f agent-c

# Trigger agent-a manually (skip cron)
docker compose exec agent-a python -c "from agent import run_research; import asyncio; asyncio.run(run_research())"
```
