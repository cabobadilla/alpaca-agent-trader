/**
 * wheel.ts — The Wheel options strategy engine
 *
 * Strategy rules:
 *   Phase 1 – Cash-Secured Put (CSP):
 *     If we hold shares but have NO open short put → sell a CSP
 *     Strike: closest to 0.30 delta put, 30-45 DTE
 *
 *   Phase 2 – CSP Management:
 *     If we have an open short put:
 *       • P&L ≥ 50% of max credit → BTC (buy to close, take profit)
 *       • DTE ≤ 21               → Roll (BTC + sell new contract further out)
 *
 *   Phase 3 – Covered Call (CC):
 *     If we hold ≥ 100 shares AND have no open short call → sell a CC
 *     Strike: closest to 0.30 delta call, 30-45 DTE
 *
 *   Phase 4 – CC Management:
 *     Same rules as CSP: 50% profit close or 21 DTE roll.
 *
 * Tickers: derived from current equity positions at runtime.
 */

import fs from 'fs';
import path from 'path';
import alpaca from '../alpaca';
import {
  getOptionsChain,
  getOptionsSnapshot,
  getOptionsPositions,
  placeOptionOrder,
  getMarketClock,
  dte,
  midPrice,
  OptionsContract,
  OptionsSnapshot,
  OptionsPosition,
} from './alpacaOptions';

const LOG_FILE = path.join('/app/logs', 'wheel.log');

// ── Config ────────────────────────────────────────────────────────────────────

const TARGET_DELTA = 0.30;
const MIN_DTE = 30;
const MAX_DTE = 45;
const ROLL_DTE_THRESHOLD = 21;
const PROFIT_CLOSE_PCT = 0.50;   // close at 50% of max premium
const CONTRACTS_PER_POSITION = 1; // sell 1 contract per position

// ── Logging ───────────────────────────────────────────────────────────────────

interface WheelAction {
  timestamp: string;
  ticker: string;
  action: string;
  symbol?: string;
  qty?: number;
  limitPrice?: number;
  reason?: string;
  orderId?: string;
  error?: string;
}

function log(entry: WheelAction) {
  const line = JSON.stringify(entry);
  console.log('[wheel]', line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pick the contract whose delta is closest to TARGET_DELTA */
function bestContract(
  contracts: OptionsContract[],
  snapshots: Record<string, OptionsSnapshot>,
  optionType: 'call' | 'put',
): { contract: OptionsContract; snapshot: OptionsSnapshot; mid: number } | null {
  let best: { contract: OptionsContract; snapshot: OptionsSnapshot; mid: number } | null = null;
  let bestDeltaDiff = Infinity;

  for (const c of contracts) {
    const snap = snapshots[c.symbol];
    if (!snap?.greeks) continue;

    const delta = Math.abs(snap.greeks.delta); // puts have negative delta; we compare magnitude
    const diff = Math.abs(delta - TARGET_DELTA);
    const mid = midPrice(snap);
    if (mid === null || mid <= 0) continue;

    if (diff < bestDeltaDiff) {
      bestDeltaDiff = diff;
      best = { contract: c, snapshot: snap, mid };
    }
  }

  return best;
}

/** Parse the underlying symbol out of an OCC option symbol (e.g. AAPL240119P00150000 → AAPL) */
function underlyingFromOCC(occSymbol: string): string {
  return occSymbol.replace(/\d.*$/, '');
}

/**
 * Extract expiration date from an OCC symbol.
 * OCC format: {ROOT}{YYMMDD}{C|P}{strike×1000 padded to 8}
 * e.g. AAPL240119P00150000 → "2024-01-19"
 */
function expirationFromOCC(occSymbol: string): string {
  const m = occSymbol.match(/^[A-Z]+(\d{2})(\d{2})(\d{2})[CP]/);
  if (!m) return '';
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

/** True if the position represents a short option */
function isShort(pos: OptionsPosition): boolean {
  return parseFloat(pos.qty) < 0;
}

/** Profit % on a short option position (positive = profit) */
function profitPct(pos: OptionsPosition): number {
  const entry = parseFloat(pos.avg_entry_price);
  const current = parseFloat(pos.current_price);
  if (entry === 0) return 0;
  // Short position: we collected premium; profit when current price < entry
  return (entry - current) / entry;
}

// ── Main runner ───────────────────────────────────────────────────────────────

export interface WheelRunResult {
  checkedAt: string;
  marketOpen: boolean;
  tickers: string[];
  actions: WheelAction[];
}

export async function runWheel(): Promise<WheelRunResult> {
  const checkedAt = new Date().toISOString();
  const actions: WheelAction[] = [];
  const push = (a: WheelAction) => { log(a); actions.push(a); };

  // 1. Market hours check
  const clock = await getMarketClock();
  if (!clock.is_open) {
    return { checkedAt, marketOpen: false, tickers: [], actions: [] };
  }

  // 2. Fetch equity positions to determine tickers
  const equityPositions = await alpaca.getPositions();
  const equityMap: Record<string, { qty: number; symbol: string }> = {};
  for (const p of equityPositions) {
    equityMap[p.symbol] = { qty: parseFloat(p.qty), symbol: p.symbol };
  }
  const tickers = Object.keys(equityMap);

  // 3. Fetch all open option positions
  const optionPositions = await getOptionsPositions();

  // Group option positions by underlying
  const shortPuts: Record<string, OptionsPosition[]> = {};
  const shortCalls: Record<string, OptionsPosition[]> = {};
  for (const op of optionPositions) {
    if (!isShort(op)) continue;
    const underlying = underlyingFromOCC(op.symbol);
    const isPut = op.symbol.match(/P\d{8}$/);
    if (isPut) {
      shortPuts[underlying] = shortPuts[underlying] ?? [];
      shortPuts[underlying].push(op);
    } else {
      shortCalls[underlying] = shortCalls[underlying] ?? [];
      shortCalls[underlying].push(op);
    }
  }

  // 4. Process each ticker
  for (const ticker of tickers) {
    const equity = equityMap[ticker];
    const openPuts = shortPuts[ticker] ?? [];
    const openCalls = shortCalls[ticker] ?? [];

    try {
      // ── Phase 2 & 4: Manage existing short options ──────────────────────────
      for (const pos of [...openPuts, ...openCalls]) {
        const daysLeft = dte(expirationFromOCC(pos.symbol));
        const profit = profitPct(pos);
        const isPut = pos.symbol.match(/P\d{8}$/) !== null;
        const optType = isPut ? 'put' : 'call';
        const mid = parseFloat(pos.current_price);

        if (profit >= PROFIT_CLOSE_PCT) {
          // Take profit: buy to close
          const order = await placeOptionOrder({
            symbol: pos.symbol,
            qty: Math.abs(parseFloat(pos.qty)),
            side: 'buy',
            limitPrice: mid,
          });
          push({
            timestamp: checkedAt, ticker, action: `close_${optType}`,
            symbol: pos.symbol, limitPrice: mid,
            reason: `${(profit * 100).toFixed(0)}% profit ≥ 50% target`,
            orderId: order.id,
          });
        } else if (daysLeft <= ROLL_DTE_THRESHOLD) {
          // Roll: BTC current + STO new contract further out
          const btcOrder = await placeOptionOrder({
            symbol: pos.symbol,
            qty: Math.abs(parseFloat(pos.qty)),
            side: 'buy',
            limitPrice: mid,
          });
          push({
            timestamp: checkedAt, ticker, action: `roll_btc_${optType}`,
            symbol: pos.symbol, limitPrice: mid,
            reason: `${daysLeft} DTE ≤ 21 roll threshold`,
            orderId: btcOrder.id,
          });

          // Open new contract
          const chain = await getOptionsChain(ticker, optType, MIN_DTE, MAX_DTE);
          const syms = chain.map((c) => c.symbol);
          const snapshots = await getOptionsSnapshot(syms);
          const picked = bestContract(chain, snapshots, optType);
          if (picked) {
            const stoOrder = await placeOptionOrder({
              symbol: picked.contract.symbol,
              qty: CONTRACTS_PER_POSITION,
              side: 'sell',
              limitPrice: picked.mid,
            });
            push({
              timestamp: checkedAt, ticker, action: `roll_sto_${optType}`,
              symbol: picked.contract.symbol,
              limitPrice: picked.mid,
              reason: `Rolled to ${picked.contract.expiration_date} strike ${picked.contract.strike_price}`,
              orderId: stoOrder.id,
            });
          }
        } else {
          push({
            timestamp: checkedAt, ticker, action: `hold_${optType}`,
            symbol: pos.symbol,
            reason: `${daysLeft} DTE, ${(profit * 100).toFixed(1)}% profit — no action needed`,
          });
        }
      }

      // ── Phase 1: Sell CSP if no open puts ──────────────────────────────────
      if (openPuts.length === 0) {
        const chain = await getOptionsChain(ticker, 'put', MIN_DTE, MAX_DTE);
        if (chain.length === 0) {
          push({ timestamp: checkedAt, ticker, action: 'skip_csp', reason: 'No put contracts found in range' });
          continue;
        }
        const syms = chain.map((c) => c.symbol);
        const snapshots = await getOptionsSnapshot(syms);
        const picked = bestContract(chain, snapshots, 'put');
        if (!picked) {
          push({ timestamp: checkedAt, ticker, action: 'skip_csp', reason: 'No contracts with valid delta/quote' });
          continue;
        }
        const order = await placeOptionOrder({
          symbol: picked.contract.symbol,
          qty: CONTRACTS_PER_POSITION,
          side: 'sell',
          limitPrice: picked.mid,
        });
        push({
          timestamp: checkedAt, ticker, action: 'sell_csp',
          symbol: picked.contract.symbol,
          limitPrice: picked.mid,
          reason: `delta≈${picked.snapshot.greeks!.delta.toFixed(2)}, exp ${picked.contract.expiration_date}, strike ${picked.contract.strike_price}`,
          orderId: order.id,
        });
      }

      // ── Phase 3: Sell CC if ≥100 shares and no open calls ──────────────────
      if (equity.qty >= 100 && openCalls.length === 0) {
        const chain = await getOptionsChain(ticker, 'call', MIN_DTE, MAX_DTE);
        if (chain.length === 0) {
          push({ timestamp: checkedAt, ticker, action: 'skip_cc', reason: 'No call contracts found in range' });
          continue;
        }
        const syms = chain.map((c) => c.symbol);
        const snapshots = await getOptionsSnapshot(syms);
        const picked = bestContract(chain, snapshots, 'call');
        if (!picked) {
          push({ timestamp: checkedAt, ticker, action: 'skip_cc', reason: 'No contracts with valid delta/quote' });
          continue;
        }
        const contractsToSell = Math.floor(equity.qty / 100);
        const order = await placeOptionOrder({
          symbol: picked.contract.symbol,
          qty: contractsToSell,
          side: 'sell',
          limitPrice: picked.mid,
        });
        push({
          timestamp: checkedAt, ticker, action: 'sell_cc',
          symbol: picked.contract.symbol,
          qty: contractsToSell,
          limitPrice: picked.mid,
          reason: `delta≈${picked.snapshot.greeks!.delta.toFixed(2)}, exp ${picked.contract.expiration_date}, strike ${picked.contract.strike_price}`,
          orderId: order.id,
        });
      } else if (equity.qty < 100 && openCalls.length === 0) {
        push({
          timestamp: checkedAt, ticker, action: 'skip_cc',
          reason: `Only ${equity.qty.toFixed(2)} shares — need 100 for a covered call`,
        });
      }
    } catch (err: any) {
      push({ timestamp: checkedAt, ticker, action: 'error', error: err.message });
    }
  }

  return { checkedAt, marketOpen: true, tickers, actions };
}

// ── State summary ─────────────────────────────────────────────────────────────

export async function getWheelState() {
  const equityPositions = await alpaca.getPositions();
  const optionPositions = await getOptionsPositions();

  const state = equityPositions.map((p) => {
    const ticker = p.symbol;
    const openOptions = optionPositions.filter((op) => underlyingFromOCC(op.symbol) === ticker);
    const puts = openOptions.filter((op) => op.symbol.match(/P\d{8}$/) && isShort(op));
    const calls = openOptions.filter((op) => !op.symbol.match(/P\d{8}$/) && isShort(op));

    let phase: string;
    if (puts.length > 0) phase = 'managing_csp';
    else if (parseFloat(p.qty) >= 100 && calls.length > 0) phase = 'managing_cc';
    else if (parseFloat(p.qty) >= 100) phase = 'ready_for_cc';
    else phase = 'ready_for_csp';

    return {
      ticker,
      shares: parseFloat(p.qty),
      phase,
      open_puts: puts.map((op) => ({
        symbol: op.symbol,
        profit_pct: (profitPct(op) * 100).toFixed(1) + '%',
        current_price: op.current_price,
        dte: dte(expirationFromOCC(op.symbol)),
      })),
      open_calls: calls.map((op) => ({
        symbol: op.symbol,
        profit_pct: (profitPct(op) * 100).toFixed(1) + '%',
        current_price: op.current_price,
        dte: dte(expirationFromOCC(op.symbol)),
      })),
    };
  });

  return state;
}
