import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [logs, setLogs] = useState<{ id: number; text: string }[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const runningRef = useRef(false);
  const logCounterRef = useRef(0);
  const triggeredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix 6: startStreaming declared before fetchStatus so fetchStatus can reference it
  function startStreaming() {
    // Fix 2: concurrency guard — bail if already running, close any orphan stream
    if (runningRef.current) return;
    esRef.current?.close();

    // Fix 3: clear any existing elapsed-timer before starting a new one
    if (timerRef.current) clearInterval(timerRef.current);

    runningRef.current = true;  // Fix 1: mirror running state in ref
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
        runningRef.current = false;  // Fix 1
        setRunning(false);
        if (timerRef.current) clearInterval(timerRef.current);
        fetchStatus();
        return;
      }
      // Fix 7: use stable id counter instead of array index
      setLogs(prev => [...prev, { id: logCounterRef.current++, text: line }]);
    };
    // Fix 5: only treat onerror as terminal when the browser has given up (CLOSED state)
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
        runningRef.current = false;  // Fix 1
        setRunning(false);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };
  }

  // Fix 6: wrap fetchStatus in useCallback with [agentId] dep for stability
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/agents/${agentId}/status`);
      if (!r.ok) return;  // Fix 4: ignore HTTP error responses
      const data: AgentStatus = await r.json();
      setStatus(data);
      // Fix 1: use runningRef to avoid stale closure on `running`
      if (data.running && !runningRef.current) startStreaming();
    } catch {
      // backend unreachable
    }
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => {
      clearInterval(id);
      esRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
      // Fix 8: clean up triggered reset timer on unmount
      if (triggeredTimerRef.current) clearTimeout(triggeredTimerRef.current);
    };
  }, [fetchStatus]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function handleRunNow() {
    if (running) return;
    // Fix 4: check HTTP status before proceeding
    let r: Response;
    try {
      r = await fetch(`/api/agents/${agentId}/trigger`, { method: 'POST' });
    } catch {
      return;
    }
    if (!r.ok) return;
    if (showLogs) {
      startStreaming();
    } else {
      setTriggered(true);
      // Fix 8: clear any pending triggered timer before setting a new one
      if (triggeredTimerRef.current) clearTimeout(triggeredTimerRef.current);
      triggeredTimerRef.current = setTimeout(() => setTriggered(false), 6_000);
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
            {/* Fix 7: stable keys from id counter */}
            {logs.map(({ id, text }) => (
              <div key={id}>{text}</div>
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
