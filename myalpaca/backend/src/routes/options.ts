/**
 * options.ts — Directional options trading routes
 *
 * POST /api/options/parse   — NL instruction → structured options order
 * POST /api/options/execute — place the options order on Alpaca
 *
 * Supports both long (buy) and short (sell) puts and calls.
 * If the user doesn't specify a strike/expiration, the engine finds the
 * best matching contract using delta and DTE targets.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { parseOptionsInstruction, ParsedOptionsOrder } from '../services/claude';
import {
  getOptionsChain,
  getOptionsSnapshot,
  placeOptionOrder,
  dte,
  midPrice,
  OptionsContract,
  OptionsSnapshot,
} from '../services/alpacaOptions';

const router = Router();
const LOG_FILE = path.join('/app/logs', 'trades.log');

// ── Defaults when the user doesn't specify ────────────────────────────────────

const DEFAULT_DTE = 30;           // days to expiration
const DEFAULT_DELTA = 0.40;       // slightly more aggressive than wheel for directional bets
const DTE_TOLERANCE = 15;         // ± days around target DTE

// ── Contract selection ────────────────────────────────────────────────────────

interface ContractMatch {
  contract: OptionsContract;
  snapshot: OptionsSnapshot;
  mid: number;
  daysLeft: number;
}

async function findBestContract(
  symbol: string,
  optionType: 'put' | 'call',
  targetDTE: number,
  targetDelta: number,
  strikeHint?: number,
  expirationHint?: string,
): Promise<ContractMatch | null> {
  const minDTE = Math.max(1, targetDTE - DTE_TOLERANCE);
  const maxDTE = targetDTE + DTE_TOLERANCE;

  const chain = await getOptionsChain(symbol, optionType, minDTE, maxDTE);
  if (chain.length === 0) return null;

  // If user gave a specific expiration, filter to that date
  const filtered = expirationHint
    ? chain.filter((c) => c.expiration_date === expirationHint)
    : chain;

  if (filtered.length === 0) return null;

  const syms = filtered.map((c) => c.symbol);
  const snapshots = await getOptionsSnapshot(syms);

  let best: ContractMatch | null = null;
  let bestScore = Infinity;

  for (const contract of filtered) {
    const snap = snapshots[contract.symbol];
    if (!snap?.greeks) continue;

    const mid = midPrice(snap);
    if (mid === null || mid <= 0) continue;

    const daysLeft = dte(contract.expiration_date);
    const delta = Math.abs(snap.greeks.delta);

    // If user specified a strike, prefer that exact strike
    if (strikeHint && parseFloat(contract.strike_price) !== strikeHint) continue;

    // Score = weighted combination of delta diff + DTE diff
    const deltaDiff = Math.abs(delta - targetDelta);
    const dteDiff = Math.abs(daysLeft - targetDTE) / DTE_TOLERANCE;
    const score = deltaDiff * 2 + dteDiff;

    if (score < bestScore) {
      bestScore = score;
      best = { contract, snapshot: snap, mid, daysLeft };
    }
  }

  return best;
}

// ── POST /api/options/parse ───────────────────────────────────────────────────

router.post('/parse', async (req: Request, res: Response) => {
  const { instruction } = req.body as { instruction?: string };
  if (!instruction?.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }
  try {
    const parsed = await parseOptionsInstruction(instruction);
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/options/execute ─────────────────────────────────────────────────

router.post('/execute', async (req: Request, res: Response) => {
  const body = req.body as Partial<ParsedOptionsOrder>;

  const { action, optionType, symbol, contracts, strike, expiration, dte: dtePref, deltaTarget } = body;

  if (!action || !optionType || !symbol) {
    return res.status(400).json({ error: 'action, optionType, and symbol are required' });
  }

  const targetDTE   = dtePref     ?? DEFAULT_DTE;
  const targetDelta = deltaTarget ?? DEFAULT_DELTA;
  const numContracts = Math.max(1, Math.round(contracts ?? 1));

  try {
    const match = await findBestContract(
      symbol.toUpperCase(),
      optionType,
      targetDTE,
      targetDelta,
      strike,
      expiration,
    );

    if (!match) {
      return res.status(404).json({
        error: `No ${optionType} contracts found for ${symbol} near ${targetDTE} DTE / ${targetDelta} delta`,
      });
    }

    const order = await placeOptionOrder({
      symbol: match.contract.symbol,
      qty: numContracts,
      side: action,
      limitPrice: match.mid,
    });

    const record = {
      timestamp: new Date().toISOString(),
      type: 'options',
      action,
      optionType,
      symbol,
      occSymbol: match.contract.symbol,
      strike: match.contract.strike_price,
      expiration: match.contract.expiration_date,
      daysLeft: match.daysLeft,
      delta: match.snapshot.greeks?.delta?.toFixed(3),
      contracts: numContracts,
      limitPrice: match.mid,
      order_id: order.id,
      status: order.status,
    };

    // Append to the shared trade log
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');

    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/options/parse-and-execute ───────────────────────────────────────
// Convenience endpoint: one call does NL parse + execute in sequence.

router.post('/parse-and-execute', async (req: Request, res: Response) => {
  const { instruction } = req.body as { instruction?: string };
  if (!instruction?.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }

  try {
    // Step 1: parse
    const parsed = await parseOptionsInstruction(instruction);

    // Step 2: find contract + execute
    const targetDTE   = parsed.dte          ?? DEFAULT_DTE;
    const targetDelta = parsed.deltaTarget  ?? DEFAULT_DELTA;
    const numContracts = Math.max(1, Math.round(parsed.contracts ?? 1));

    const match = await findBestContract(
      parsed.symbol.toUpperCase(),
      parsed.optionType,
      targetDTE,
      targetDelta,
      parsed.strike,
      parsed.expiration,
    );

    if (!match) {
      return res.status(404).json({
        parsed,
        error: `No ${parsed.optionType} contracts found for ${parsed.symbol} near ${targetDTE} DTE / ${targetDelta} delta`,
      });
    }

    const order = await placeOptionOrder({
      symbol: match.contract.symbol,
      qty: numContracts,
      side: parsed.action,
      limitPrice: match.mid,
    });

    const record = {
      timestamp: new Date().toISOString(),
      type: 'options',
      parsedInstruction: parsed,
      action: parsed.action,
      optionType: parsed.optionType,
      symbol: parsed.symbol,
      occSymbol: match.contract.symbol,
      strike: match.contract.strike_price,
      expiration: match.contract.expiration_date,
      daysLeft: match.daysLeft,
      delta: match.snapshot.greeks?.delta?.toFixed(3),
      contracts: numContracts,
      limitPrice: match.mid,
      order_id: order.id,
      status: order.status,
    };

    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');

    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
