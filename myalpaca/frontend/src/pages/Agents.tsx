import { useEffect, useRef, useState } from 'react';

interface AgentStatus {
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  strategyReady?: boolean;
}

function fmt(isoStr: string | null, opts: Intl.DateTimeFormatOptions): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('en-US', opts);
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
};

const SHORT_OPTS: Intl.DateTimeFormatOptions = {
  month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
};

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface AgentCardProps {
  agentId: 'a' | 'b' | 'c';
  name: string;
  model: string;
  showLogs?: boolean;
}

function AgentCard({ agentId, name, model, showLogs = false }: AgentCardProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => {
      clearInterval(id);
      esRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function fetchStatus() {
    try {
      const r = await fetch(`/api/agents/${agentId}/status`);
      const data: AgentStatus = await r.json();
      setStatus(data);
      if (data.running && !running) startStreaming();
    } catch {
      // backend unreachable
    }
  }

  function startStreaming() {
    setRunning(true);
    setLogs([]);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)),
      1000
    );
    const es = new EventSource(`/api/agents/${agentId}/logs`);
    esRef.current = es;
    es.onmessage = (e) => {
      const line: string = JSON.parse(e.data);
      if (line === '__done__') {
        es.close();
        esRef.current = null;
        setRunning(false);
        if (timerRef.current) clearInterval(timerRef.current);
        fetchStatus();
        return;
      }
      setLogs(prev => [...prev, line]);
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }

  async function handleRunNow() {
    if (running) return;
    try {
      await fetch(`/api/agents/${agentId}/trigger`, { method: 'POST' });
    } catch {
      return;
    }
    if (showLogs) {
      startStreaming();
    } else {
      setTriggered(true);
      setTimeout(() => setTriggered(false), 6_000);
      fetchStatus();
    }
  }

  const isC = agentId === 'c';
  const canRun = isC ? (status?.strategyReady ?? false) : true;
  const disabledReason = isC && !canRun ? 'Run Agent A and B first' : undefined;

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded p-4 space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-white font-semibold">{name}</span>
          <span className="text-[#8B949E] text-xs ml-2 font-mono">{model}</span>
        </div>
        {isC && status && (
          <span className={`text-xs px-2 py-0.5 rounded font-mono ${
            status.strategyReady
              ? 'bg-green-900/40 text-green-400'
              : 'bg-yellow-900/40 text-yellow-400'
          }`}>
            {status.strategyReady ? 'Ready to run' : 'Waiting for strategies'}
          </span>
        )}
      </div>

      <div className="text-xs text-[#8B949E] font-mono space-y-0.5">
        <div>Last run: <span className="text-white">{fmt(status?.lastRun ?? null, SHORT_OPTS)}</span></div>
        {!isC && (
          <div>Next scheduled: <span className="text-white">{fmt(status?.nextRun ?? null, DATE_OPTS)}</span></div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleRunNow}
          disabled={running || !canRun}
          title={disabledReason}
          className={`text-sm px-3 py-1.5 rounded font-mono transition-colors ${
            running || !canRun
              ? 'bg-[#21262D] text-[#8B949E] cursor-not-allowed'
              : 'bg-[#1F6FEB] text-white hover:bg-[#388BFD]'
          }`}
        >
          {running ? 'Running…' : isC ? 'Run Agent C' : 'Run Now'}
        </button>
        {running && (
          <span className="text-yellow-400 text-xs font-mono">⟳ {fmtElapsed(elapsed)}</span>
        )}
        {triggered && (
          <span className="text-green-400 text-xs font-mono">
            ✓ Triggered — check Approvals page
          </span>
        )}
      </div>

      {showLogs && (running || logs.length > 0) && (
        <div className="mt-1">
          <div className="text-xs text-[#8B949E] mb-1 font-mono">
            {running ? `Running — ${fmtElapsed(elapsed)}` : 'Completed'}
          </div>
          <div className="bg-[#010409] border border-[#30363D] rounded p-3 h-52 overflow-y-auto font-mono text-xs text-green-400 space-y-px">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Research Agents</h1>
      <div className="space-y-4">
        <AgentCard agentId="a" name="Agent A" model="Claude Sonnet" showLogs />
        <AgentCard agentId="b" name="Agent B" model="GPT-4o-mini" showLogs />
        <AgentCard agentId="c" name="Agent C" model="Execution" />
      </div>
    </div>
  );
}
