import { useEffect, useState } from 'react';

interface TradeItem {
  symbol: string;
  side: string;
  notional: number;
  rationale: string;
  risk_level: string;
  source_agreement: string;
}

interface ApprovalRecord {
  plan_id: string;
  date: string;
  summary: string;
  trades: TradeItem[];
  total_notional: number;
  risk_summary: string;
  agent_reasoning: string;
  strategy_agreement_score: number;
  key_disagreements: string[];
  portfolio_snapshot: { equity?: string; cash?: string; buying_power?: string };
  status: string;
  created_at: string;
  expires_at: string;
  decision: string | null;
  decided_at: string | null;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    AWAITING_SEND:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    EMAIL_SENT:     'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    AWAITING_REPLY: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    APPROVED:       'bg-green-500/20  text-[#00C805]  border-green-500/30',
    REJECTED:       'bg-red-500/20    text-[#FF5000]  border-red-500/30',
    EXPIRED:        'bg-[#21262D]     text-[#8B949E]  border-[#30363D]',
  };
  const cls = map[status] ?? 'bg-[#21262D] text-[#8B949E] border-[#30363D]';
  return (
    <span className={`text-xs border px-2 py-0.5 rounded font-mono ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function agreementColor(score: number) {
  if (score >= 0.75) return 'text-[#00C805]';
  if (score >= 0.5)  return 'text-yellow-400';
  return 'text-[#FF5000]';
}

function minutesUntil(iso: string) {
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (diff <= 0) return 'Expired';
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

function fmt(val: string | undefined) {
  if (!val) return '—';
  return `$${parseFloat(val).toLocaleString()}`;
}

export default function Approvals() {
  const [plans, setPlans]       = useState<ApprovalRecord[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const [reasons, setReasons]   = useState<Record<string, string>>({});
  const [showReason, setShowReason] = useState<Record<string, boolean>>({});
  const [decideError, setDecideError] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function fetchPlans() {
    fetch('/api/approvals/pending')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPlans(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchPlans();
    const id = setInterval(fetchPlans, 30_000);
    return () => clearInterval(id);
  }, []);

  async function decide(planId: string, decision: 'APPROVED' | 'REJECTED') {
    setDeciding((d) => ({ ...d, [planId]: true }));
    setDecideError((e) => ({ ...e, [planId]: '' }));
    try {
      const res = await fetch(`/api/approvals/${planId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, decision, reason: reasons[planId] ?? null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      fetchPlans();
    } catch (e: any) {
      setDecideError((err) => ({ ...err, [planId]: e.message }));
    } finally {
      setDeciding((d) => ({ ...d, [planId]: false }));
    }
  }

  if (loading) {
    return <p className="text-[#8B949E] font-mono text-sm mt-8">Loading pending plans...</p>;
  }

  if (error) {
    return (
      <div className="mt-8 bg-red-900/20 border border-red-500/30 rounded p-4">
        <p className="text-red-400 font-mono text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Pending Trade Plans</h1>
        <button
          onClick={() => { setLoading(true); fetchPlans(); }}
          className="text-xs text-[#8B949E] hover:text-white font-mono border border-[#30363D] px-3 py-1 rounded hover:border-[#8B949E] transition-colors"
        >
          Refresh
        </button>
      </div>

      {plans.length === 0 && (
        <div className="bg-[#161B22] border border-[#30363D] rounded p-8 text-center">
          <p className="text-[#8B949E] font-mono text-sm">No plans awaiting approval</p>
        </div>
      )}

      {plans.map((plan) => {
        const isPending = ['AWAITING_SEND', 'EMAIL_SENT', 'AWAITING_REPLY'].includes(plan.status);
        const score = plan.strategy_agreement_score;
        const isDeciding = deciding[plan.plan_id];

        return (
          <div key={plan.plan_id} className="bg-[#161B22] border border-[#30363D] rounded">
            {/* Header */}
            <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-[#30363D]">
              <span className="text-white font-mono text-sm font-semibold">{plan.date}</span>
              {statusBadge(plan.status)}
              <span className="text-xs text-[#8B949E] font-mono">
                Expires in: <span className="text-white">{minutesUntil(plan.expires_at)}</span>
              </span>
              <span className="text-xs text-[#8B949E] font-mono">
                Agreement:{' '}
                <span className={`font-semibold ${agreementColor(score)}`}>
                  {Math.round(score * 100)}%
                </span>
              </span>
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Summary */}
              <p className="text-sm text-[#8B949E]">{plan.summary}</p>

              {/* Portfolio snapshot */}
              {Object.keys(plan.portfolio_snapshot).length > 0 && (
                <div>
                  <p className="text-xs text-[#8B949E] uppercase tracking-wider mb-2">Portfolio Snapshot</p>
                  <div className="grid grid-cols-3 gap-3">
                    {(['equity', 'cash', 'buying_power'] as const).map((k) => (
                      <div key={k} className="bg-[#0D1117] border border-[#30363D] rounded p-3">
                        <p className="text-xs text-[#8B949E] capitalize">{k.replace('_', ' ')}</p>
                        <p className="font-mono text-white text-sm font-semibold">
                          {fmt(plan.portfolio_snapshot[k])}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trades table */}
              {plan.trades.length > 0 && (
                <div>
                  <p className="text-xs text-[#8B949E] uppercase tracking-wider mb-2">Trades</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[#30363D]">
                          {['Symbol', 'Side', 'Notional', 'Risk', 'Agreement', 'Rationale'].map((h) => (
                            <th key={h} className="text-left text-[#8B949E] pb-2 pr-4">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {plan.trades.map((t, i) => (
                          <tr key={i} className="border-b border-[#30363D]/50 last:border-0">
                            <td className="py-2 pr-4 text-white font-semibold">{t.symbol}</td>
                            <td className={`py-2 pr-4 font-semibold ${t.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF5000]'}`}>
                              {t.side.toUpperCase()}
                            </td>
                            <td className="py-2 pr-4 text-white">${t.notional.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-[#8B949E]">{t.risk_level.toUpperCase()}</td>
                            <td className="py-2 pr-4 text-[#8B949E]">{t.source_agreement}</td>
                            <td className="py-2 text-[#8B949E] max-w-xs truncate">{t.rationale}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-[#8B949E] mt-2 font-mono">
                    Total notional: <span className="text-white">${plan.total_notional.toLocaleString()}</span>
                    {' · '}Risk: <span className="text-white">{plan.risk_summary}</span>
                  </p>
                </div>
              )}

              {/* Agent reasoning (collapsible) */}
              <div>
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [plan.plan_id]: !e[plan.plan_id] }))}
                  className="text-xs text-[#8B949E] hover:text-white font-mono flex items-center gap-1"
                >
                  <span>{expanded[plan.plan_id] ? '▾' : '▸'}</span>
                  Strategy Reasoning
                </button>
                {expanded[plan.plan_id] && (
                  <pre className="mt-2 bg-[#0D1117] border border-[#30363D] rounded p-3 text-xs text-[#8B949E] whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                    {plan.agent_reasoning}
                  </pre>
                )}
              </div>

              {/* Key disagreements */}
              {plan.key_disagreements.length > 0 && (
                <div>
                  <p className="text-xs text-[#8B949E] uppercase tracking-wider mb-1">Key Disagreements</p>
                  <ul className="space-y-1">
                    {plan.key_disagreements.map((d, i) => (
                      <li key={i} className="text-xs text-yellow-400 font-mono">· {d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action bar */}
              {isPending && (
                <div className="border-t border-[#30363D] pt-4 space-y-3">
                  <div className="flex flex-wrap gap-3 items-center min-w-0">
                    <button
                      onClick={() => decide(plan.plan_id, 'APPROVED')}
                      disabled={isDeciding}
                      className="px-5 py-2 bg-[#238636] hover:bg-[#2EA043] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded font-mono transition-colors"
                    >
                      {isDeciding ? 'Processing...' : 'APPROVE'}
                    </button>
                    <button
                      onClick={() =>
                        showReason[plan.plan_id]
                          ? decide(plan.plan_id, 'REJECTED')
                          : setShowReason((s) => ({ ...s, [plan.plan_id]: true }))
                      }
                      disabled={isDeciding}
                      className="px-5 py-2 bg-[#21262D] hover:bg-red-900/40 border border-[#30363D] hover:border-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-[#FF5000] text-sm rounded font-mono transition-colors"
                    >
                      {showReason[plan.plan_id] ? 'Confirm Reject' : 'REJECT'}
                    </button>
                    {showReason[plan.plan_id] && (
                      <button
                        onClick={() => setShowReason((s) => ({ ...s, [plan.plan_id]: false }))}
                        className="text-xs text-[#8B949E] hover:text-white font-mono"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {decideError[plan.plan_id] && (
                    <div className="bg-red-900/20 border border-red-500/30 rounded px-3 py-2">
                      <p className="text-red-400 font-mono text-xs">{decideError[plan.plan_id]}</p>
                    </div>
                  )}
                  {showReason[plan.plan_id] && (
                    <input
                      type="text"
                      placeholder="Reason for rejection (optional)"
                      value={reasons[plan.plan_id] ?? ''}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [plan.plan_id]: e.target.value }))
                      }
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded p-2 text-white font-mono text-sm focus:outline-none focus:border-red-500/50 placeholder-[#8B949E]"
                    />
                  )}
                </div>
              )}

              {/* Decided state + retry */}
              {!isPending && (
                <div className="border-t border-[#30363D] pt-4 space-y-3">
                  {plan.decision && (
                    <p className="text-xs text-[#8B949E] font-mono">
                      Decision: {statusBadge(plan.decision)}
                      {plan.decided_at && (
                        <span className="ml-2">at {new Date(plan.decided_at).toLocaleString()}</span>
                      )}
                    </p>
                  )}
                  {(plan.status === 'REJECTED' || plan.status === 'EXPIRED') && (
                    <button
                      onClick={async () => {
                        try {
                          const r = await fetch('/api/agents/c/trigger', { method: 'POST' });
                          if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        } catch (e: any) {
                          setDecideError(err => ({ ...err, [plan.plan_id]: e.message }));
                        }
                      }}
                      className="text-xs px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] hover:text-white rounded font-mono transition-colors"
                    >
                      Re-run Agent C
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
