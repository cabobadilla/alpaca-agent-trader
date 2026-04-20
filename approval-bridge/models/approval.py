"""
approval-bridge/models/approval.py
-------------------------------------
Pydantic models for approval records and decisions.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class TradeItem(BaseModel):
    """A single trade within a trade plan."""

    symbol: str = Field(..., description="Ticker symbol, e.g. AAPL")
    side: str = Field(..., description="buy or sell")
    notional: float = Field(..., description="Dollar notional amount")
    rationale: str = Field(..., description="LLM rationale for the trade")
    risk_level: str = Field(..., description="low | medium | high")
    source_agreement: str = Field(
        default="BOTH",
        description="Which agents agreed: BOTH | CLAUDE_ONLY | GPT_ONLY",
    )


class TradePlanCreate(BaseModel):
    """Payload sent by agent-c to POST /plans."""

    plan_id: str = Field(..., description="UUID of this plan")
    date: str = Field(..., description="Trading date YYYY-MM-DD")
    summary: str = Field(..., description="Short human-readable summary")
    trades: list[TradeItem] = Field(default_factory=list)
    total_notional: float = Field(..., description="Sum of all trade notionals")
    risk_summary: str = Field(..., description="Overall risk assessment")
    agent_reasoning: str = Field(..., description="Full agent reasoning text")
    strategy_agreement_score: float = Field(
        ..., description="0.0–1.0 score of strategy alignment"
    )
    key_disagreements: list[str] = Field(
        default_factory=list,
        description="Points where claude and gpt strategies diverged",
    )
    portfolio_snapshot: dict = Field(
        default_factory=dict,
        description="Current portfolio state: equity, cash, buying_power",
    )


class ApprovalRecord(TradePlanCreate):
    """Full approval record stored on disk and returned via API."""

    status: str = Field(default="AWAITING_SEND", description="Lifecycle status")
    created_at: str = Field(..., description="ISO8601 timestamp when record was created")
    expires_at: str = Field(..., description="ISO8601 timestamp when approval expires")
    email_sent_at: Optional[str] = Field(default=None)
    decided_at: Optional[str] = Field(default=None)
    decision: Optional[str] = Field(default=None)
    rejection_reason: Optional[str] = Field(default=None)


class ApprovalDecision(BaseModel):
    """Payload sent by the frontend to record a human approval decision."""

    plan_id: str = Field(..., description="UUID of the plan being decided")
    decision: Literal["APPROVED", "REJECTED"] = Field(
        ..., description="Human decision: APPROVED or REJECTED"
    )
    reason: Optional[str] = Field(default=None, description="Optional notes/reason")


class ApprovalStatusResponse(BaseModel):
    """Minimal response model for the GET /plans/{id}/status endpoint."""

    plan_id: str
    status: str
    decision: Optional[str]
    decided_at: Optional[str]
    expires_at: str
