import { Fragment, useEffect, useRef, useState } from 'react';

interface LogEvent {
  id: string;
  timestamp: string;
  agent: string;
  event_type: string;
  level: string;
  plan_id: string | null;
  phase: string | null;
  message: string;
  metadata: Record<string, unknown>;
}

const LEVEL_STYLES: Record<string, string> = {
  INFO:  'text-[#8B949E]',
  WARN:  'text-yellow-400',
  ERROR: 'text-red-400',
};

const ROW_BG: Record<string, string> = {
  WARN:  'bg-yellow-900/10',
  ERROR: 'bg-red-900/20',
};

const TYPE_COLOR: Record<string, string> = {
  agent_phase:    'text-blue-400',
  agent_error:    'text-red-400',
  plan_submitted: 'text-purple-400',
  plan_decision:  'text-yellow-400',
  trade_executed: 'text-green-400',
  trade_failed:   'text-orange-400',
};

export default function Logs() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  function fetchEvents() {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (agentFilter) params.set('agent', agentFilter);
    if (levelFilter) params.set('level', levelFilter);
    fetch(`/api/events?${params}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: LogEvent[]) => { setEvents(data); setError(null); })
      .catch(() => setError('Failed to load events. Is the backend running?'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchEvents(); }, [agentFilter, levelFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) { esRef.current?.close(); esRef.current = null; return; }
    const es = new EventSource('/api/events/stream');
    esRef.current = es;
    es.onmessage = (e) => {
      const ev: LogEvent = JSON.parse(e.data);
      setEvents(prev => [ev, ...prev].slice(0, 500));
    };
    return () => { es.close(); esRef.current = null; };
  }, [live]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-white">Event Logs</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="bg-[#161B22] border border-[#30363D] text-[#8B949E] text-xs rounded px-2 py-1 font-mono"
          >
            <option value="">All agents</option>
            <option value="agent-a">Agent A</option>
            <option value="agent-b">Agent B</option>
            <option value="agent-c">Agent C</option>
          </select>
          <select
            value={levelFilter}
            onChange={e => setLevelFilter(e.target.value)}
            className="bg-[#161B22] border border-[#30363D] text-[#8B949E] text-xs rounded px-2 py-1 font-mono"
          >
            <option value="">All levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
          <button
            onClick={() => setLive(l => !l)}
            className={`text-xs px-3 py-1 rounded font-mono border transition-colors ${
              live
                ? 'bg-green-900/30 border-green-500/30 text-green-400'
                : 'bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-white'
            }`}
          >
            {live ? '● Live' : 'Live'}
          </button>
          <button
            onClick={fetchEvents}
            className="text-xs text-[#8B949E] hover:text-white font-mono border border-[#30363D] px-3 py-1 rounded hover:border-[#8B949E] transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded p-3">
          <p className="text-red-400 font-mono text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-[#8B949E] font-mono text-sm">Loading events…</p>
      ) : events.length === 0 ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded p-8 text-center">
          <p className="text-[#8B949E] font-mono text-sm">
            No events yet — run an agent to generate the first events.
          </p>
        </div>
      ) : (
        <div className="border border-[#30363D] rounded overflow-hidden">
          <table className="w-full text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-[#30363D] bg-[#161B22] text-[#8B949E] uppercase">
                <th className="text-left py-2 px-3 whitespace-nowrap">Time</th>
                <th className="text-left py-2 px-3">Agent</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Level</th>
                <th className="text-left py-2 px-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <Fragment key={ev.id}>
                  <tr
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                    className={`border-b border-[#21262D] cursor-pointer hover:bg-[#161B22] transition-colors ${ROW_BG[ev.level] ?? ''}`}
                  >
                    <td className="py-1.5 px-3 text-[#8B949E] whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-1.5 px-3 text-white">{ev.agent}</td>
                    <td className={`py-1.5 px-3 ${TYPE_COLOR[ev.event_type] ?? 'text-[#8B949E]'}`}>
                      {ev.event_type}
                    </td>
                    <td className={`py-1.5 px-3 ${LEVEL_STYLES[ev.level] ?? 'text-[#8B949E]'}`}>
                      {ev.level}
                    </td>
                    <td className="py-1.5 px-3 text-[#E6EDF3] max-w-sm truncate">
                      {ev.message}
                    </td>
                  </tr>
                  {expanded === ev.id && (
                    <tr key={`${ev.id}-exp`} className="border-b border-[#21262D]">
                      <td colSpan={5} className="px-3 py-3 bg-[#0D1117]">
                        <pre className="text-[#8B949E] text-xs whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(ev, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
