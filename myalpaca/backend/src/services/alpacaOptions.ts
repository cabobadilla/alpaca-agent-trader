/**
 * alpacaOptions.ts
 * Direct REST client for Alpaca's options API.
 * Alpaca splits its surface across two base URLs:
 *   BROKER_URL  — trading ops: orders, positions, clock, contracts
 *   DATA_URL    — market data: snapshots, Greeks, quotes, trades
 */

const BROKER_URL = 'https://paper-api.alpaca.markets/v2';
const DATA_URL   = 'https://data.alpaca.markets/v1beta1';

function headers() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
    'Content-Type': 'application/json',
  };
}

async function get<T>(path: string, params?: Record<string, string>, base = BROKER_URL): Promise<T> {
  const url = new URL(`${base}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BROKER_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BROKER_URL}${path}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca DELETE ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OptionsContract {
  id: string;
  symbol: string;           // OCC symbol e.g. AAPL240119P00150000
  underlying_symbol: string;
  expiration_date: string;  // YYYY-MM-DD
  strike_price: string;
  type: 'call' | 'put';
  open_interest: string;
}

export interface OptionsSnapshot {
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
  impliedVolatility?: number;
  latestQuote?: {
    ap: number; // ask price
    bp: number; // bid price
    as: number; // ask size
    bs: number; // bid size
  };
  latestTrade?: { p: number; s: number };
}

export interface OptionsPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  qty_available: string;
  side: 'long' | 'short';
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  asset_class: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  created_at: string;
}

// ── Market clock ─────────────────────────────────────────────────────────────

export async function getMarketClock(): Promise<{ is_open: boolean; next_open: string; next_close: string }> {
  return get('/clock');
}

// ── Options chain ─────────────────────────────────────────────────────────────

export async function getOptionsChain(
  underlyingSymbol: string,
  optionType: 'call' | 'put',
  minDTE: number,
  maxDTE: number,
): Promise<OptionsContract[]> {
  const today = new Date();
  const minExp = new Date(today);
  minExp.setDate(today.getDate() + minDTE);
  const maxExp = new Date(today);
  maxExp.setDate(today.getDate() + maxDTE);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const data = await get<{ option_contracts: OptionsContract[] }>('/options/contracts', {
    underlying_symbols: underlyingSymbol,
    type: optionType,
    expiration_date_gte: fmt(minExp),
    expiration_date_lte: fmt(maxExp),
    limit: '100',
  });

  return data.option_contracts ?? [];
}

// ── Options snapshots (Greeks) ────────────────────────────────────────────────

export async function getOptionsSnapshot(symbols: string[]): Promise<Record<string, OptionsSnapshot>> {
  if (symbols.length === 0) return {};
  // Snapshots with Greeks live on the market data API, not the broker API
  const data = await get<{ snapshots: Record<string, OptionsSnapshot> }>(
    '/options/snapshots',
    { symbols: symbols.join(','), feed: 'indicative' },
    DATA_URL,
  );
  return data.snapshots ?? {};
}

// ── Open options positions ────────────────────────────────────────────────────

export async function getOptionsPositions(): Promise<OptionsPosition[]> {
  const all = await get<OptionsPosition[]>('/positions');
  return all.filter((p) => p.asset_class === 'us_option');
}

// ── Place an option order ─────────────────────────────────────────────────────

export interface PlaceOptionOrderParams {
  symbol: string;       // OCC symbol
  qty: number;
  side: 'buy' | 'sell';
  limitPrice: number;   // mid-price for limit orders
  orderClass?: string;
}

export async function placeOptionOrder(params: PlaceOptionOrderParams): Promise<AlpacaOrder> {
  return post<AlpacaOrder>('/orders', {
    symbol: params.symbol,
    qty: String(params.qty),
    side: params.side,
    type: 'limit',
    time_in_force: 'day',
    limit_price: params.limitPrice.toFixed(2),
    order_class: params.orderClass ?? 'simple',
  });
}

// ── Cancel an order ───────────────────────────────────────────────────────────

export async function cancelOrder(orderId: string): Promise<void> {
  await del(`/orders/${orderId}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Days to expiration from today */
export function dte(expirationDate: string): number {
  const exp = new Date(expirationDate + 'T00:00:00Z');
  const now = new Date();
  return Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Mid-price from a snapshot quote */
export function midPrice(snapshot: OptionsSnapshot): number | null {
  const q = snapshot.latestQuote;
  if (!q || q.ap == null || q.bp == null) return null;
  return (q.ap + q.bp) / 2;
}
