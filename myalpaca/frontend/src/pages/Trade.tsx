import { useState } from 'react';

interface ParsedTrade {
  side: 'buy' | 'sell';
  symbol: string;
  notional: number;
  display: string;
}

interface TradeResult {
  timestamp: string;
  side: string;
  symbol: string;
  notional: number;
  order_id: string;
  status: string;
  filled_avg_price: string | null;
  filled_qty: string | null;
  created_at: string;
}

type Step = 'input' | 'confirm' | 'result';

export default function Trade() {
  const [step, setStep] = useState<Step>('input');
  const [instruction, setInstruction] = useState('');
  const [parsed, setParsed] = useState<ParsedTrade | null>(null);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleParse() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/trade/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setParsed(data);
      setStep('confirm');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (!parsed) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setStep('result');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep('input');
    setInstruction('');
    setParsed(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-lg font-semibold text-white">Natural Language Trade</h1>

      {/* Step 1 — input */}
      {step === 'input' && (
        <div className="bg-[#161B22] border border-[#30363D] rounded p-5 space-y-4">
          <p className="text-xs text-[#8B949E]">
            Describe a trade in plain English. e.g. <span className="text-white">"Buy Apple for 100 dollars"</span> or <span className="text-white">"Sell Tesla 200 USD"</span>
          </p>
          <textarea
            className="w-full bg-[#0D1117] border border-[#30363D] rounded p-3 text-white font-mono text-sm resize-none focus:outline-none focus:border-[#58A6FF] placeholder-[#8B949E]"
            rows={3}
            placeholder="Buy Apple 100 dollars..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && instruction.trim()) {
                e.preventDefault();
                handleParse();
              }
            }}
          />
          {error && <p className="text-red-400 text-sm font-mono">{error}</p>}
          <button
            onClick={handleParse}
            disabled={!instruction.trim() || loading}
            className="px-4 py-2 bg-[#238636] hover:bg-[#2EA043] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded font-mono transition-colors"
          >
            {loading ? 'Parsing...' : 'Parse Instruction →'}
          </button>
        </div>
      )}

      {/* Step 2 — confirm */}
      {step === 'confirm' && parsed && (
        <div className="space-y-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded p-5 space-y-4">
            <p className="text-xs text-[#8B949E] uppercase tracking-wider">Parsed Order</p>
            <div className="space-y-2">
              <Row label="Action" value={parsed.side.toUpperCase()} color={parsed.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF5000]'} />
              <Row label="Symbol" value={parsed.symbol} />
              <Row label="Amount" value={`$${parsed.notional.toLocaleString()}`} />
              <Row label="Type" value="Market Order · Day" />
            </div>
            <div className="border-t border-[#30363D] pt-3">
              <p className="text-white font-mono text-base font-semibold">{parsed.display}</p>
              <p className="text-[#8B949E] text-xs mt-1">Paper trading — no real money involved</p>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm font-mono">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleExecute}
              disabled={loading}
              className="px-5 py-2 bg-[#238636] hover:bg-[#2EA043] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded font-mono transition-colors"
            >
              {loading ? 'Executing...' : 'Confirm & Execute'}
            </button>
            <button
              onClick={reset}
              className="px-5 py-2 bg-[#21262D] hover:bg-[#30363D] text-[#8B949E] text-sm rounded font-mono transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — result */}
      {step === 'result' && result && (
        <div className="space-y-4">
          <div className="bg-[#161B22] border border-[#238636]/50 rounded p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00C805]" />
              <p className="text-[#00C805] text-sm font-mono font-semibold">Order Submitted</p>
            </div>
            <div className="space-y-2">
              <Row label="Order ID" value={result.order_id} mono />
              <Row label="Status" value={result.status.toUpperCase()} />
              <Row label="Side" value={result.side.toUpperCase()} color={result.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF5000]'} />
              <Row label="Symbol" value={result.symbol} />
              <Row label="Notional" value={`$${result.notional.toLocaleString()}`} />
              {result.filled_avg_price && (
                <Row label="Fill Price" value={`$${parseFloat(result.filled_avg_price).toFixed(4)}`} />
              )}
              {result.filled_qty && (
                <Row label="Filled Qty" value={result.filled_qty} />
              )}
              <Row label="Submitted" value={new Date(result.created_at).toLocaleString()} />
            </div>
            <p className="text-[#8B949E] text-xs border-t border-[#30363D] pt-3">
              Logged to <code className="font-mono">logs/trades.log</code>
            </p>
          </div>

          <button
            onClick={reset}
            className="px-5 py-2 bg-[#238636] hover:bg-[#2EA043] text-white text-sm rounded font-mono transition-colors"
          >
            New Trade
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  color = 'text-white',
  mono = false,
}: {
  label: string;
  value: string;
  color?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-[#8B949E]">{label}</span>
      <span className={`text-sm ${color} ${mono ? 'font-mono text-xs truncate max-w-[220px]' : ''}`}>{value}</span>
    </div>
  );
}
