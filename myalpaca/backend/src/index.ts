import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import healthRouter from './routes/health';
import accountRouter from './routes/account';
import tradeRouter from './routes/trade';
import wheelRouter from './routes/wheel';
import optionsRouter from './routes/options';
import intelRouter from './routes/intel';
import approvalsRouter from './routes/approvals';

const app = express();
const PORT = process.env.PORT || 3001;

// ensure logs directory exists
fs.mkdirSync('/app/logs', { recursive: true });

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/account', accountRouter);
app.use('/api/trade', tradeRouter);
app.use('/api/wheel', wheelRouter);
app.use('/api/options', optionsRouter);
app.use('/api/intel',   intelRouter);
app.use('/api/approvals', approvalsRouter);

app.listen(PORT, () => {
  console.log(`Alpaca Trader API running on http://localhost:${PORT}`);
  console.log('Routes: /api/health, /api/account, /api/trade, /api/wheel, /api/options, /api/intel');
});
