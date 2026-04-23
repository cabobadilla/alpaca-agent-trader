import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const BRIDGE_URL = (process.env.APPROVAL_BRIDGE_URL ?? 'http://approval-bridge:8080').replace(/\/$/, '');
const APPROVALS_DIR = process.env.APPROVALS_DIR || '/data/approvals';

async function proxyTo(bridgePath: string, req: Request, res: Response): Promise<void> {
  try {
    const url = `${BRIDGE_URL}${bridgePath}`;
    const init: RequestInit = { method: req.method };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(req.body ?? {});
    }
    const upstream = await fetch(url, init);
    const body = await upstream.text();
    res.status(upstream.status).set('Content-Type', 'application/json').send(body);
  } catch (err: any) {
    res.status(502).json({ error: 'approval-bridge unreachable', detail: err.message });
  }
}

// GET /api/approvals/pending
router.get('/pending', (req, res) => proxyTo('/plans/pending', req, res));

// GET /api/approvals/all — all plans (not just pending), newest first
router.get('/all', async (_req: Request, res: Response) => {
  try {
    const files = await fs.readdir(APPROVALS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
    const records = (
      await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const resolved = path.resolve(APPROVALS_DIR, file);
            if (!resolved.startsWith(path.resolve(APPROVALS_DIR) + path.sep)) return null;
            const raw = await fs.readFile(resolved, 'utf8');
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    res.json(records);
  } catch {
    res.json([]);
  }
});

const PLAN_ID_RE = /^[\w-]+$/;

// GET /api/approvals/:planId/status
router.get('/:planId/status', (req, res) => {
  if (!PLAN_ID_RE.test(req.params.planId)) return res.status(400).json({ error: 'Invalid plan ID' });
  return proxyTo(`/plans/${req.params.planId}/status`, req, res);
});

// POST /api/approvals/:planId/decide
router.post('/:planId/decide', (req, res) => {
  if (!PLAN_ID_RE.test(req.params.planId)) return res.status(400).json({ error: 'Invalid plan ID' });
  return proxyTo(`/plans/${req.params.planId}/decide`, req, res);
});

export default router;
