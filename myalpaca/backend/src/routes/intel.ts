/**
 * intel.ts — Market intelligence API routes
 *
 * GET  /api/intel/recommendations          — on-demand brief (optional ?symbols=NVDA,AMD)
 * POST /api/intel/morning-brief            — called by scheduler each morning
 * GET  /api/intel/briefs                   — list past saved briefs
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import alpaca from '../alpaca';
import { generateMarketBrief } from '../services/marketIntel';

const router  = Router();

// ── GET /api/intel/ping — smoke test ──────────────────────────────────────────
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});
const LOG_DIR = '/app/logs';
const BRIEF_FILE = path.join(LOG_DIR, 'intel_briefs.log');

// ── GET /api/intel/recommendations ────────────────────────────────────────────

router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    // Pull current positions to add to the watchlist
    const positions = await alpaca.getPositions();
    const positionSymbols = positions.map((p: any) => p.symbol as string);

    // Allow extra symbols via query string: ?symbols=NVDA,AMD
    const extraSymbols = req.query.symbols
      ? (req.query.symbols as string).toUpperCase().split(',').map((s) => s.trim())
      : [];

    const brief = await generateMarketBrief([...positionSymbols, ...extraSymbols]);

    res.json(brief);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/intel/morning-brief ────────────────────────────────────────────

router.post('/morning-brief', async (_req: Request, res: Response) => {
  try {
    const positions = await alpaca.getPositions();
    const positionSymbols = positions.map((p: any) => p.symbol as string);

    const brief = await generateMarketBrief(positionSymbols);

    // Persist to log file
    fs.appendFileSync(BRIEF_FILE, JSON.stringify(brief) + '\n');

    res.json(brief);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/intel/briefs ─────────────────────────────────────────────────────

router.get('/briefs', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(BRIEF_FILE)) {
      return res.json([]);
    }
    const lines = fs.readFileSync(BRIEF_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // newest first

    // Return summaries only (not full raw signals) to keep response small
    const summaries = lines.map((b: any) => ({
      generatedAt:        b.generatedAt,
      marketContext:      b.marketContext,
      recommendationCount: b.recommendations?.length ?? 0,
      topRecommendation:  b.recommendations?.[0] ?? null,
    }));

    res.json(summaries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
