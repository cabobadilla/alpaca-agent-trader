import { Router, Request, Response } from 'express';

const router = Router();
const BRIDGE_URL = (process.env.APPROVAL_BRIDGE_URL ?? 'http://approval-bridge:8080').replace(/\/$/, '');

async function proxyTo(bridgePath: string, req: Request, res: Response): Promise<void> {
  try {
    const url = `${BRIDGE_URL}${bridgePath}`;
    const init: RequestInit = { method: req.method };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(req.body);
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

// GET /api/approvals/:planId/status
router.get('/:planId/status', (req, res) =>
  proxyTo(`/plans/${req.params.planId}/status`, req, res),
);

// POST /api/approvals/:planId/decide
router.post('/:planId/decide', (req, res) =>
  proxyTo(`/plans/${req.params.planId}/decide`, req, res),
);

export default router;
