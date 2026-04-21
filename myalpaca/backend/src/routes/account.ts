import { Router, Request, Response } from 'express';
import alpaca from '../alpaca';

const router = Router();

// GET /api/account — account summary
router.get('/', async (_req: Request, res: Response) => {
  try {
    const account = await alpaca.getAccount();
    res.json({
      equity: account.equity,
      cash: account.cash,
      buying_power: account.buying_power,
      portfolio_value: account.portfolio_value,
      day_trade_count: account.daytrade_count,
      pnl_today: (parseFloat(account.equity) - parseFloat(account.last_equity)).toFixed(2),
      currency: account.currency,
      status: account.status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account/positions — open positions
router.get('/positions', async (_req: Request, res: Response) => {
  try {
    const positions = await alpaca.getPositions();
    res.json(positions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account/orders — recent orders
router.get('/orders', async (_req: Request, res: Response) => {
  try {
    const orders = await alpaca.getOrders({ status: 'all', limit: 50, until: undefined, after: undefined, direction: undefined, nested: undefined, symbols: undefined });
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
