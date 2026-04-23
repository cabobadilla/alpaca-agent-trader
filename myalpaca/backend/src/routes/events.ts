import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const EVENTS_DIR = process.env.EVENTS_DIR || '/data/events';

// GET /api/events?agent=agent-c&level=ERROR&limit=200
router.get('/', async (req: Request, res: Response) => {
  const agentFilter = req.query.agent as string | undefined;
  const levelFilter = (req.query.level as string | undefined)?.toUpperCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);

  let files: string[];
  try {
    files = await fs.readdir(EVENTS_DIR);
  } catch {
    return res.json([]);
  }

  const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

  const events = (
    await Promise.all(
      jsonFiles.slice(0, limit * 5).map(async (file) => {
        try {
          const raw = await fs.readFile(path.join(EVENTS_DIR, file), 'utf8');
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
    )
  )
    .filter(Boolean)
    .filter((e: any) => !agentFilter || e.agent === agentFilter)
    .filter((e: any) => !levelFilter || e.level === levelFilter)
    .slice(0, limit);

  res.json(events);
});

// GET /api/events/stream — SSE, pushes new events as they arrive
router.get('/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Start from current newest file — only stream events that arrive after connection
  let lastSeenFile = '';
  try {
    const existing = (await fs.readdir(EVENTS_DIR)).filter(f => f.endsWith('.json')).sort();
    if (existing.length > 0) lastSeenFile = existing[existing.length - 1];
  } catch {}

  const poll = async () => {
    try {
      const files = (await fs.readdir(EVENTS_DIR))
        .filter(f => f.endsWith('.json'))
        .sort()
        .filter(f => f > lastSeenFile);

      for (const file of files) {
        try {
          const raw = await fs.readFile(path.join(EVENTS_DIR, file), 'utf8');
          const event = JSON.parse(raw);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          lastSeenFile = file;
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // events dir not mounted yet
    }
  };

  const interval = setInterval(poll, 3000);
  req.on('close', () => clearInterval(interval));
});

export default router;
