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
import agentsRouter from './routes/agents';
import historyRouter from './routes/history';
import eventsRouter from './routes/events';

const app = express();
const PORT = process.env.PORT || 3001;

// ensure logs directory exists
try { fs.mkdirSync('/app/logs', { recursive: true }); } catch {}

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/account', accountRouter);
app.use('/api/trade', tradeRouter);
app.use('/api/wheel', wheelRouter);
app.use('/api/options', optionsRouter);
app.use('/api/intel',   intelRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/history', historyRouter);
app.use('/api/events', eventsRouter);

app.listen(PORT, () => {
  console.log(`Alpaca Trader API running on http://localhost:${PORT}`);
  console.log('Routes: /api/health, /api/account, /api/trade, /api/wheel, /api/options, /api/intel, /api/agents, /api/history, /api/events');
});
