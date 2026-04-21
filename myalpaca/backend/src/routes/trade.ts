import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import alpaca from '../alpaca';
import { parseTradeInstruction } from '../services/claude';

const router = Router();
const LOG_FILE = path.join('/app/logs', 'trades.log');

// POST /api/trade/parse — use Haiku to turn natural language into a trade
router.post('/parse', async (req: Request, res: Response) => {
  const { instruction } = req.body as { instruction?: string };
  if (!instruction?.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }
  try {
    const parsed = await parseTradeInstruction(instruction);
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trade/execute — place the order on Alpaca and log it
router.post('/execute', async (req: Request, res: Response) => {
  const { side, symbol, notional } = req.body as {
    side?: string;
    symbol?: string;
    notional?: number;
  };

  if (!side || !symbol || !notional) {
    return res.status(400).json({ error: 'side, symbol and notional are required' });
  }

  try {
    const order = await (alpaca as any).createOrder({
      symbol,
      notional: notional.toString(),
      side,
      type: 'market',
      time_in_force: 'day',
    });

    const record = {
      timestamp: new Date().toISOString(),
      side,
      symbol,
      notional,
      order_id: order.id,
      status: order.status,
      filled_avg_price: order.filled_avg_price ?? null,
      filled_qty: order.filled_qty ?? null,
      created_at: order.created_at,
    };

    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');

    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
