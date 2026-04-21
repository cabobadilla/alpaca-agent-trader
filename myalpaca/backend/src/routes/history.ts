import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

const TRADEPLANS_DIR = process.env.TRADEPLANS_DIR || '/data/tradeplans';
const APPROVALS_DIR = process.env.APPROVALS_DIR || '/data/approvals';

const APPROVAL_DISPLAY_STATUS: Record<string, string> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  AWAITING_SEND: 'PENDING',
  EMAIL_SENT: 'PENDING',
  AWAITING_REPLY: 'PENDING',
};

router.get('/', async (_req: Request, res: Response) => {
  let files: string[];
  try {
    files = await fs.readdir(TRADEPLANS_DIR);
  } catch {
    return res.json([]);
  }

  const planFiles = files
    .filter(f => f.startsWith('tradeplan_') && f.endsWith('.json'))
    .sort()
    .reverse();

  const plans = await Promise.all(
    planFiles.map(async (file) => {
      const raw = await fs.readFile(path.join(TRADEPLANS_DIR, file), 'utf8');
      const plan = JSON.parse(raw);

      let approvalStatus = 'PENDING';
      let rejectionReason: string | null = null;

      try {
        const approvalRaw = await fs.readFile(
          path.join(APPROVALS_DIR, `${plan.plan_id}.json`),
          'utf8'
        );
        const approval = JSON.parse(approvalRaw);
        approvalStatus = APPROVAL_DISPLAY_STATUS[approval.status] ?? approval.status;
        rejectionReason = approval.rejection_reason ?? null;
      } catch {
        // no approval record yet — stays PENDING
      }

      return { ...plan, approvalStatus, rejectionReason };
    })
  );

  res.json(plans);
});

export default router;
