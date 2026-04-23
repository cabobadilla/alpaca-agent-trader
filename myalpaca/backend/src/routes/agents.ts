import { Router, Request, Response } from 'express';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const router = Router();

const AGENT_HOSTS: Record<string, { host: string; port: number }> = {
  a: { host: process.env.AGENT_A_HOST || 'agent-a', port: 5001 },
  b: { host: process.env.AGENT_B_HOST || 'agent-b', port: 5002 },
  c: { host: process.env.AGENT_C_HOST || 'agent-c', port: 5003 },
};

const AGENT_CRONS: Record<string, string> = {
  a: process.env.AGENT_A_CRON || '0 6 * * 1',
  b: process.env.AGENT_B_CRON || '0 6 * * 1',
  c: process.env.AGENT_C_CRON || '0 9 * * 1-5',
};

const TZ = process.env.TZ || 'America/New_York';
const STRATEGIES_DIR = process.env.STRATEGIES_DIR || '/data/strategies';

function isValidAgent(agent: string): agent is 'a' | 'b' | 'c' {
  return ['a', 'b', 'c'].includes(agent);
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

async function checkStrategiesReady(): Promise<boolean> {
  const now = new Date();
  const week = isoWeek(now);
  const weekStr = `${now.getFullYear()}-${String(week).padStart(2, '0')}`;
  try {
    await fs.access(path.join(STRATEGIES_DIR, `strategy_claude_${weekStr}.md`));
    await fs.access(path.join(STRATEGIES_DIR, `strategy_gpt_${weekStr}.md`));
    return true;
  } catch {
    return false;
  }
}

// POST /api/agents/:agent/trigger
router.post('/:agent/trigger', async (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const r = await fetch(`http://${host}:${port}/trigger`, { method: 'POST', signal: ac.signal }).finally(() => clearTimeout(timer));
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Cannot reach agent-${agent}: ${err.message}` });
  }
});

// GET /api/agents/:agent/logs — SSE proxy
router.get('/:agent/logs', (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const agentReq = http.get({ host, port, path: '/logs' }, (agentRes) => {
    agentRes.pipe(res);
    req.on('close', () => { agentReq.destroy(); agentRes.destroy(); });
  });

  agentReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify('Connection error: ' + err.message)}\n\n`);
    res.write(`data: ${JSON.stringify('__done__')}\n\n`);
    res.end();
  });
});

// GET /api/agents/:agent/status
router.get('/:agent/status', async (req: Request, res: Response) => {
  const { agent } = req.params;
  if (!isValidAgent(agent)) return res.status(404).json({ error: 'Unknown agent' });
  const { host, port } = AGENT_HOSTS[agent];

  let running = false;
  let lastRun: string | null = null;
  const extra: Record<string, unknown> = {};

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const r = await fetch(`http://${host}:${port}/status`, { signal: ac.signal }).finally(() => clearTimeout(timer));
    const data = await r.json() as {
      running: boolean;
      lastRun: string | null;
      phase?: string | null;
      plan_id?: string | null;
      phase_updated_at?: string | null;
      last_error?: string | null;
    };
    running = data.running;
    lastRun = data.lastRun;
    extra.phase = data.phase ?? null;
    extra.plan_id = data.plan_id ?? null;
    extra.phase_updated_at = data.phase_updated_at ?? null;
    extra.last_error = data.last_error ?? null;
  } catch {
    // agent unreachable — report not running
  }

  let nextRun: string | null = null;
  try {
    const interval = CronExpressionParser.parse(AGENT_CRONS[agent], { tz: TZ });
    nextRun = interval.next().toISOString();
  } catch {
    // ignore invalid cron
  }

  if (agent === 'c') {
    extra.strategyReady = await checkStrategiesReady();
  }

  res.json({ running, lastRun, nextRun, ...extra });
});

export default router;
