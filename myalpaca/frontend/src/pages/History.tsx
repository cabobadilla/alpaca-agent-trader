import React, { useEffect, useState } from 'react';

interface Trade {
  symbol: string;
  side: 'buy' | 'sell';
  notional: number;
  risk_level: 'low' | 'medium' | 'high';
  source_agreement: 'BOTH' | 'CLAUDE_ONLY' | 'GPT_ONLY';
}

interface HistoryEntry {
  plan_id: string;
  date: string;
  strategy_agreement_score: number;
  trades: Trade[];
  total_notional: number;
  agent_reasoning: string;
  key_disagreements: string[];
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-900/40 text-green-400',
  REJECTED: 'bg-red-900/40 text-red-400',
  EXPIRED:  'bg-[#21262D] text-[#8B949E]',
  PENDING:  'bg-yellow-900/40 text-yellow-400',
};

const RISK_COLOR: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};

function AgreementPct({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono text-sm ${color}`}>{pct}%</span>;
}

function ExpandedRow({ entry }: { entry: HistoryEntry }) {
  const [showFull, setShowFull] = useState(false);
  const reasoning = entry.agent_reasoning ?? '';
  const truncated = reasoning.length > 300;
  const display = showFull ? reasoning : reasoning.slice(0, 300);

  return (
    <tr>
      <td colSpan={5} className="px-4 py-4 bg-[#0D1117] border-b border-[#30363D]">
        <div className="space-y-4 max-w-4xl">

          <div>
            <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">
              Synthesis Reasoning
            </div>
            <p className="text-sm text-[#E6EDF3] font-mono leading-relaxed">
              {display}
              {truncated && !showFull && (
                <button
                  onClick={() => setShowFull(true)}
                  className="text-blue-400 ml-1 hover:underline"
                >
                  …show more
                </button>
              )}
            </p>
          </div>

          {entry.key_disagreements?.length > 0 && (
            <div>
              <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">
                Key Disagreements
              </div>
              <ul className="space-y-1">
                {entry.key_disagreements.map((d) => (
                  <li key={d} className="text-sm text-yellow-400 font-mono">⚡ {d}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-2">
              Trade Breakdown
            </div>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="text-[#8B949E] border-b border-[#30363D]">
                  <th className="text-left py-1 pr-4">Symbol</th>
                  <th className="text-left py-1 pr-4">Side</th>
                  <th className="text-right py-1 pr-4">Notional</th>
                  <th className="text-left py-1 pr-4">Risk</th>
                  <th className="text-left py-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {(entry.trades ?? []).map((t) => (
                  <tr key={`${t.symbol}-${t.side}`} className="border-b border-[#21262D]">
                    <td className="py-1 pr-4 text-white">{t.symbol}</td>
                    <td className={`py-1 pr-4 ${t.side === 'buy' ? 'text-blue-400' : 'text-red-400'}`}>
                      {t.side.toUpperCase()}
                    </td>
                    <td className="py-1 pr-4 text-right text-white">
                      ${t.notional.toLocaleString()}
                    </td>
                    <td className={`py-1 pr-4 ${RISK_COLOR[t.risk_level] ?? ''}`}>
                      {t.risk_level}
                    </td>
                    <td className="py-1 text-[#8B949E]">{t.source_agreement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {entry.rejectionReason && (
            <div>
              <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">
                Rejection Reason
              </div>
              <p className="text-sm text-red-400 font-mono">{entry.rejectionReason}</p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function History() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/history')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!Array.isArray(data)) throw new Error('Unexpected response');
        setHistory(data as HistoryEntry[]);
      })
      .catch(() => setError('Failed to load history. Is the backend running?'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-[#8B949E] font-mono text-sm mt-8">Loading history…</div>;
  }

  if (error) {
    return <div className="mt-8 text-red-400 font-mono text-sm">{error}</div>;
  }

  if (history.length === 0) {
    return (
      <div className="mt-8 text-[#8B949E] font-mono text-sm">
        No execution history yet — run Agent C to generate the first trade plan.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Execution History</h1>
      <div className="border border-[#30363D] rounded overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#30363D] bg-[#161B22] text-[#8B949E] text-xs uppercase">
              <th className="text-left py-2 px-4">Date</th>
              <th className="text-left py-2 px-4">Agreement</th>
              <th className="text-left py-2 px-4">Tickers</th>
              <th className="text-right py-2 px-4">Total</th>
              <th className="text-left py-2 px-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map(entry => (
              <React.Fragment key={entry.plan_id}>
                <tr
                  onClick={() => setExpanded(expanded === entry.plan_id ? null : entry.plan_id)}
                  className="border-b border-[#21262D] cursor-pointer hover:bg-[#161B22] transition-colors"
                >
                  <td className="py-2 px-4 font-mono text-white">{entry.date}</td>
                  <td className="py-2 px-4">
                    <AgreementPct score={entry.strategy_agreement_score} />
                  </td>
                  <td className="py-2 px-4 font-mono text-sm">
                    {(entry.trades ?? []).map((t, i) => (
                      <span key={`${t.symbol}-${t.side}-${i}`}>
                        <span className={t.side === 'buy' ? 'text-blue-400' : 'text-red-400'}>
                          {t.symbol}
                        </span>
                        {i < (entry.trades ?? []).length - 1 && (
                          <span className="text-[#30363D]"> · </span>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 px-4 font-mono text-white text-right">
                    {'$' + entry.total_notional.toLocaleString('en-US')}
                  </td>
                  <td className="py-2 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded font-mono ${STATUS_STYLES[entry.approvalStatus] ?? ''}`}>
                      {entry.approvalStatus}
                    </span>
                  </td>
                </tr>
                {expanded === entry.plan_id && <ExpandedRow entry={entry} />}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
