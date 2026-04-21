# Integration Plan: Merging myAlpaca into alpaca-agent-trader
**Author:** Christian Bobadilla  
**Date:** 2026-04-20  
**Status:** Draft — pending user review before implementation

---

## 1. Executive Summary

Two sibling projects exist today:

| Project | Repo | Role |
|---|---|---|
| **alpaca-agent-trader** | this repo | Python AI agents + approval gateway |
| **myAlpaca** | github.com/cabobadilla/myAlpaca | Node.js Alpaca API connector + React frontend |

The goal is to **absorb myAlpaca into this repo** so that:
- One `docker-compose.yml` starts the entire system
- One React frontend serves both portfolio management and trade approval workflows
- No code is contributed back to the myAlpaca repository — it becomes a vendored source inside this repo

---

## 2. Current Architecture

```
[ alpaca-agent-trader repo ]           [ myAlpaca repo (external) ]
┌──────────────────────────┐           ┌──────────────────────────┐
│ agent-a (Python cron)    │           │ Express API (port 3001)  │
│ agent-b (Python cron)    │           │  GET /health             │
│ agent-c (Python cron) ───┼──────────►│  GET /account            │
│ approval-bridge (FastAPI)│           │  GET /positions          │
│   port 8080              │           │  GET /orders             │
└──────────────────────────┘           │  POST /orders            │
                                       ├──────────────────────────┤
  No frontend in this repo             │ React/Vite frontend      │
                                       │   port 5173              │
  Approval UI expected at:             │   Portfolio dashboard    │
  http://localhost:5173/approvals      │   (no /approvals yet)    │
                                       └──────────────────────────┘
```

**Pain points:**
- Two separate repos to clone, configure, and start
- Two separate `.env` files
- The approval workflow has no frontend — email says "go to localhost:5173/approvals" but that page doesn't exist yet
- Docker images must be built separately; myAlpaca referenced as pre-built `myalpaca:local`

---

## 3. Target Architecture

```
[ alpaca-agent-trader (unified repo) ]
┌──────────────────────────────────────────────────────────────────┐
│  DOCKER COMPOSE NETWORK: alpaca-net                              │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ agent-a       │  │ agent-b       │  │ agent-c           │   │
│  │ Python cron   │  │ Python cron   │  │ Python cron       │   │
│  │ (unchanged)   │  │ (unchanged)   │  │ (unchanged)       │   │
│  └───────────────┘  └───────────────┘  └────────┬──────────┘   │
│                                                  │              │
│         writes /data/strategies/                 │              │
│         reads  /data/strategies/  ───────────────┘              │
│                                                                  │
│  ┌─────────────────────────────────┐                            │
│  │ approval-bridge (FastAPI)       │                            │
│  │ port 8080 (internal only)       │◄── agent-c submits plans  │
│  └───────────────┬─────────────────┘                            │
│                  │ proxy via Express                             │
│                  │                                               │
│  ┌───────────────▼────────────────────────────────────────┐    │
│  │ myalpaca (Node.js Express)  port 3001 → host           │    │
│  │  Existing: /health, /account, /positions, /orders      │    │
│  │  New:      /api/approvals/* (proxy → approval-bridge)  │    │
│  ├────────────────────────────────────────────────────────┤    │
│  │ React/Vite frontend  port 5173 → host                  │    │
│  │  Existing pages: portfolio dashboard                   │    │
│  │  New page:       /approvals  (approve/reject trades)   │    │
│  └────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**Single user entry point:** `http://localhost:5173`

---

## 4. Assumptions About myAlpaca

> **Note:** The myAlpaca repository at `https://github.com/cabobadilla/myAlpaca` returned HTTP 404 at time of writing — it is likely private. The plan below is based on the API contract documented in `agent-c/myalpaca_client.py`, `docs/architecture.md`, and the Node.js/TypeScript Express + React/Vite stack inferred from the port numbers and architecture docs.
>
> **Action required:** Confirm the assumptions in Section 4.2 before starting Phase 1.

### 4.1 Known Facts (from current codebase)

| Fact | Source |
|---|---|
| Express API on port 3001 | docker-compose.yml, myalpaca_client.py |
| `GET /health` returns `{"status":"ok"}` | myalpaca_client.py |
| `GET /account` returns equity, cash, buying_power | myalpaca_client.py |
| `GET /positions` returns open positions list | myalpaca_client.py |
| `GET /orders` returns open/recent orders list | myalpaca_client.py |
| `POST /orders` accepts `{symbol, side, notional, type, time_in_force}` | myalpaca_client.py |
| React/Vite dev server on port 5173 | architecture.md (Q3 decision) |
| Architecture doc says "myAlpaca frontend (React/Vite) gets a new /approvals route" | architecture.md |
| Alpaca credentials stay isolated in myAlpaca container only | architecture.md § 9.5 |

### 4.2 Assumed File Structure (to be verified)

```
myalpaca/
├── package.json          ← Node.js project (likely monorepo or separate client/ + server/)
├── server/               ← OR src/  (Express backend)
│   ├── index.ts          ← Express entry point
│   ├── routes/
│   │   ├── account.ts    ← GET /account, /positions, /orders
│   │   ├── orders.ts     ← POST /orders
│   │   └── health.ts     ← GET /health
│   └── alpaca.ts         ← Alpaca Markets SDK integration
├── client/               ← OR src/  (React frontend)
│   ├── main.tsx
│   ├── App.tsx
│   └── pages/
│       └── Dashboard.tsx ← Portfolio dashboard
├── .env.example
└── Dockerfile (if exists)
```

---

## 5. What Gets Built

### 5.1 Changes to This Repo (alpaca-agent-trader)

| Item | Change |
|---|---|
| `myalpaca/` directory | **New** — vendored copy of myAlpaca source |
| `myalpaca/Dockerfile` | **New** (or update existing) — builds combined Express+React image |
| `myalpaca/server/routes/approvals.ts` | **New** — proxy routes to approval-bridge |
| `myalpaca/client/pages/Approvals.tsx` | **New** — approval UI page |
| `docker-compose.yml` | **Update** — build myalpaca from local source, expose ports |
| `.env.example` | **Update** — add Alpaca API key vars |
| `approval-bridge/main.py` | **Minor** — remove host port mapping (internal only) |

### 5.2 What Does NOT Change

- `agent-a/` — untouched
- `agent-b/` — untouched  
- `agent-c/` — untouched (already uses correct myAlpaca API contract)
- `approval-bridge/` — minimal changes only (CORS config for proxy pattern)
- myAlpaca source repository — never touched

---

## 6. Phased Implementation Plan

### Phase 1 — Vendor myAlpaca Source (no functional changes)

**Goal:** Bring myAlpaca source into this repo and verify the existing integration still works.

**Steps:**
1. Clone myAlpaca repo locally and copy its source into `myalpaca/` in this repo
2. Audit `myalpaca/` structure against Section 4.2 assumptions — correct the plan where needed
3. Write or update `myalpaca/Dockerfile` to:
   - Install Node.js dependencies
   - Build the React frontend (production bundle)
   - Serve static frontend from Express (or keep separate Vite dev server for development)
4. Update `docker-compose.yml`:
   - Change `image: myalpaca:local` → `build: ./myalpaca`
   - Map host ports: `3001:3001` (API), `5173:5173` (frontend dev) or `5173:3001` if Express serves static
5. Add Alpaca credentials to `.env.example`:
   ```
   ALPACA_API_KEY=
   ALPACA_SECRET_KEY=
   ALPACA_BASE_URL=https://paper-api.alpaca.markets
   ```
6. Run `docker compose up --build` and verify all existing agent workflows still work

**Definition of Done:**
- `docker compose up` starts all services from a single command
- agent-c health check passes against myAlpaca container
- GET `/account`, `/positions`, `/orders` return real data from Alpaca paper API

---

### Phase 2 — Add Approval Proxy to Express

**Goal:** Allow the React frontend to reach the approval-bridge without CORS issues or exposing port 8080 to the host.

**Add Express routes in `myalpaca/server/routes/approvals.ts`:**

```typescript
// Proxy approval-bridge endpoints through Express
// approval-bridge is only reachable on the internal Docker network

GET  /api/approvals/pending         → GET  approval-bridge:8080/plans/pending
GET  /api/approvals/:planId/status  → GET  approval-bridge:8080/plans/:planId/status
POST /api/approvals/:planId/decide  → POST approval-bridge:8080/plans/:planId/decide
```

**Implementation notes:**
- Use `node-fetch` or `axios` to proxy (already likely a dependency)
- `APPROVAL_BRIDGE_URL` env var (default: `http://approval-bridge:8080`) — same as other services
- Add error passthrough: if approval-bridge returns 4xx/5xx, forward status + body
- No authentication required at this stage (approval flow is email-triggered, single user)

**Docker-compose update:**
- Remove `ports: - "8080:8080"` from approval-bridge (it becomes internal only)
- Add `APPROVAL_BRIDGE_URL=http://approval-bridge:8080` to myalpaca environment

**Definition of Done:**
- `GET http://localhost:3001/api/approvals/pending` returns pending plans (via proxy)
- `POST http://localhost:3001/api/approvals/{id}/decide` with `{decision: "APPROVED"}` updates plan status
- Port 8080 is no longer exposed on the host

---

### Phase 3 — Build the Approvals UI Page

**Goal:** Add `/approvals` page to the React frontend so users can review and approve/reject trade plans from the browser.

**New React page: `myalpaca/client/pages/Approvals.tsx`**

**Page layout:**

```
/approvals
├── Header: "Pending Trade Plans" + refresh button
├── If no pending plans: empty state ("No plans awaiting approval")
└── For each pending plan:
    ├── Plan header
    │   ├── Date: Mon Apr 20, 2026
    │   ├── Status badge: AWAITING_REPLY (yellow) | APPROVED (green) | REJECTED (red) | EXPIRED (grey)
    │   ├── Expires in: 47 minutes
    │   └── Agreement score: 87% (color: green >75%, yellow 50-75%, red <50%)
    ├── Portfolio snapshot (at time of plan)
    │   ├── Equity: $52,340
    │   ├── Cash: $12,100
    │   └── Buying Power: $24,200
    ├── Trades table
    │   ├── Symbol | Side | Notional | Risk | Agreement | Rationale
    │   ├── AAPL   | BUY  | $2,000  | LOW  | BOTH      | "Strong AI exposure..."
    │   └── TSLA   | SELL | $800    | HIGH | CLAUDE_ONLY| "Overvalued given..."
    ├── Strategy reasoning
    │   └── Collapsible: full agent_reasoning text
    ├── Key disagreements (if any)
    │   └── List of disagreement strings
    └── Action bar (only shown if status == AWAITING_REPLY)
        ├── [APPROVE] button (green, prominent)
        ├── [REJECT] button (red, secondary)
        └── Optional: rejection reason text input (shown on REJECT click)
```

**State management:**
- Poll `GET /api/approvals/pending` every 30 seconds (auto-refresh)
- Show loading state on first fetch
- Optimistic update on APPROVE/REJECT click → re-fetch to confirm

**Routing:**
- Add `/approvals` to the React Router config
- Add "Approvals" navigation link in the app header/sidebar

**Definition of Done:**
- Navigating to `http://localhost:5173/approvals` shows the approvals page
- Pending plans render with all fields from the trade plan JSON
- Clicking APPROVE updates the plan status and disables the action buttons
- Clicking REJECT with optional reason updates status and disables buttons
- The email "Review at http://localhost:5173/approvals" link works end-to-end

---

### Phase 4 — Unified Environment & Documentation

**Goal:** Clean up configuration so the project starts cleanly with one setup step.

**Steps:**
1. Merge Alpaca env vars into the root `.env.example`
2. Update `README.md` with new single-repo setup instructions
3. Verify the approval email link points to `http://localhost:5173/approvals`
4. Update `docs/architecture.md` to reflect merged architecture
5. Add `myalpaca/` to `.gitignore` exclusions as appropriate (keep source, exclude `node_modules/`, `dist/`)

**Updated `.env.example` additions:**
```bash
# Alpaca Markets (used by myAlpaca Express backend)
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets
```

---

## 7. Docker Compose Target State

```yaml
services:
  myalpaca:
    build: ./myalpaca          # ← changed from image: myalpaca:local
    ports:
      - "3001:3001"            # API (kept for agent-c direct access)
      - "5173:5173"            # Frontend (React/Vite dev) or serve static
    environment:
      ALPACA_API_KEY: ${ALPACA_API_KEY}
      ALPACA_SECRET_KEY: ${ALPACA_SECRET_KEY}
      ALPACA_BASE_URL: ${ALPACA_BASE_URL}
      APPROVAL_BRIDGE_URL: http://approval-bridge:8080  # ← new
    networks:
      - alpaca-net
    depends_on:
      approval-bridge:
        condition: service_healthy

  approval-bridge:
    build: ./approval-bridge
    # ports: removed — internal only, accessed via myalpaca proxy
    environment: ...
    networks:
      - alpaca-net
    healthcheck:
      test: python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"
      interval: 15s

  agent-a: ...   # unchanged
  agent-b: ...   # unchanged
  agent-c: ...   # unchanged (already uses http://myalpaca:3001)
```

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| myAlpaca structure differs from assumptions | Medium | High | Audit in Phase 1 before writing any new code |
| myAlpaca has no Dockerfile | Low | Medium | Write one in Phase 1; Express + Vite are straightforward to containerize |
| CORS issues if frontend calls approval-bridge directly | Low | Low | Proxy pattern in Phase 2 eliminates CORS entirely |
| Express proxy adds latency to approval decisions | Very Low | Very Low | Internal Docker network RTT is <1ms |
| React router not configured for `/approvals` | Low | Low | Standard React Router addition |
| myAlpaca uses incompatible Node.js version | Low | Medium | Pin Node version in Dockerfile; audit package.json engines field |

---

## 9. What Stays Out of Scope

These items are explicitly not part of this merge:

- **Authentication / login** — No auth added to approvals page; single-user system behind localhost
- **Telegram bot** — Architecture decision Q3 already chose email+frontend over Telegram
- **Live trading** — Paper trading only; no changes to Alpaca credentials model
- **Strategy viewer** — No UI for viewing the weekly strategy markdown files (separate concern)
- **Historical approvals** — No history page; only pending plans shown in Phase 3

---

## 10. Open Questions Before Coding

Before starting Phase 1, the following must be answered:

1. **Can you share the myAlpaca repo?**  
   The repo at `https://github.com/cabobadilla/myAlpaca` returned 404 (likely private). Either make it accessible or clone it locally and share the source so the actual structure can be audited.

2. **Does myAlpaca already have a Dockerfile?**  
   If yes, we reuse it. If not, we write one.

3. **Does myAlpaca's frontend use TypeScript?**  
   Assumed yes based on Node.js/TypeScript stack in architecture.md. Affects component file extensions.

4. **Does myAlpaca currently serve the React frontend from Express, or is Vite running separately?**  
   This affects whether we need one port or two in docker-compose.

5. **What UI component library (if any) does myAlpaca use?**  
   The approvals page will be styled to match. If none, we use plain CSS or Tailwind.

---

## 11. Success Criteria

The merge is complete when:

- [ ] `git clone` + `cp .env.example .env` + fill 7 keys + `docker compose up --build` starts the full system
- [ ] `http://localhost:5173` shows the existing portfolio dashboard unchanged
- [ ] `http://localhost:5173/approvals` shows pending trade plans with approve/reject controls
- [ ] Approving a plan via the UI triggers trade execution by agent-c
- [ ] Rejecting a plan via the UI halts agent-c without executing trades
- [ ] Port 8080 (approval-bridge) is no longer exposed on the host

---

*End of merge plan — review and approve before implementation begins*
