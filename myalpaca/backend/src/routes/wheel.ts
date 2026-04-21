import { Router, Request, Response } from 'express';
import { runWheel, getWheelState } from '../services/wheel';

const router = Router();

/**
 * POST /api/wheel/run
 * Execute one cycle of the Wheel strategy across all current equity positions.
 * Called by the hourly scheduler during market hours.
 */
router.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await runWheel();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/wheel/state
 * Returns the current Wheel phase for each ticker + any open option positions.
 */
router.get('/state', async (_req: Request, res: Response) => {
  try {
    const state = await getWheelState();
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
