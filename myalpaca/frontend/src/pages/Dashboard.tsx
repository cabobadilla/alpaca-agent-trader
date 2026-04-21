import { useEffect, useState } from 'react';

interface AccountSummary {
  equity: string;
  cash: string;
  buying_power: string;
  pnl_today: string;
  status: string;
}

export default function Dashboard() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/account')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setAccount(data);
      })
      .catch(() => setError('Cannot reach backend — is it running?'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-[#8B949E] font-mono text-sm mt-8">
        Connecting to Alpaca...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-8 bg-red-900/20 border border-red-500/30 rounded p-4">
        <p className="text-red-400 font-mono text-sm">{error}</p>
        <p className="text-[#8B949E] text-xs mt-2">
          Check that the backend is running and your API keys are set in{' '}
          <code className="font-mono">backend/.env</code>
        </p>
      </div>
    );
  }

  const pnl = parseFloat(account?.pnl_today ?? '0');

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Portfolio Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Equity" value={`$${parseFloat(account!.equity).toLocaleString()}`} />
        <StatCard label="Cash" value={`$${parseFloat(account!.cash).toLocaleString()}`} />
        <StatCard label="Buying Power" value={`$${parseFloat(account!.buying_power).toLocaleString()}`} />
        <StatCard
          label="P&L Today"
          value={`${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString()}`}
          color={pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]'}
        />
      </div>

      <div className="text-xs text-[#8B949E] font-mono">
        Account status: <span className="text-white">{account!.status}</span>
        {' · '}Paper trading mode
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded p-4">
      <p className="text-xs text-[#8B949E] mb-1">{label}</p>
      <p className={`font-mono text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
