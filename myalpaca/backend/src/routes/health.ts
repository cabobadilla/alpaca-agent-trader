import { Router, Request, Response } from 'express';
import alpaca from '../alpaca';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const account = await alpaca.getAccount();
    res.json({
      status: 'ok',
      alpaca: 'connected',
      account_status: account.status,
      paper: true,
    });
  } catch (err: any) {
    res.status(500).json({
      status: 'error',
      alpaca: 'disconnected',
      message: err.message,
    });
  }
});

export default router;
