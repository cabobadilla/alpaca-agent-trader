import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Shared retry helper ───────────────────────────────────────────────────────

async function callHaiku(prompt: string, maxTokens = 512): Promise<string> {
  const MAX_RETRIES = 3;
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = (message.content[0] as { type: 'text'; text: string }).text.trim();
      return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    } catch (err: any) {
      const isOverloaded =
        err?.status === 529 ||
        err?.error?.error?.type === 'overloaded_error' ||
        err?.message?.includes('overloaded');
      if (isOverloaded && attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        console.log(`Haiku overloaded — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        lastError = new Error('Claude API is busy — please try again in a moment');
        continue;
      }
      if (isOverloaded) throw new Error('Claude API is currently overloaded — wait a few seconds and try again');
      throw err;
    }
  }
  throw lastError;
}

// ── Equity trade parser ───────────────────────────────────────────────────────

export interface ParsedTrade {
  side: 'buy' | 'sell';
  symbol: string;
  notional: number;
  display: string;
}

const EQUITY_PROMPT = (instruction: string) => `Parse this trade instruction into JSON with these fields:
- side: "buy" or "sell"
- symbol: stock ticker in uppercase (e.g. Apple → AAPL, Tesla → TSLA, Google → GOOGL, Microsoft → MSFT, Amazon → AMZN, Meta → META, Netflix → NFLX, Nvidia → NVDA, AMD → AMD, Spotify → SPOT)
- notional: dollar amount as a number
- display: human-readable summary like "Buy AAPL $100.00"

Instruction: "${instruction}"

Respond with only valid JSON, no markdown, no explanation.`;

export async function parseTradeInstruction(instruction: string): Promise<ParsedTrade> {
  const text = await callHaiku(EQUITY_PROMPT(instruction), 256);
  const parsed = JSON.parse(text);
  if (!parsed.side || !parsed.symbol || !parsed.notional) {
    throw new Error('Could not parse trade — try something like "Buy Apple 10 dollars"');
  }
  return parsed as ParsedTrade;
}

// ── Options trade parser ──────────────────────────────────────────────────────

export interface ParsedOptionsOrder {
  action: 'buy' | 'sell';
  optionType: 'put' | 'call';
  symbol: string;
  contracts: number;          // number of contracts (default 1)
  strike?: number;            // specific strike price if mentioned
  expiration?: string;        // YYYY-MM-DD if a date was mentioned
  dte?: number;               // days to expiration if mentioned (e.g. "30 days out")
  deltaTarget?: number;       // delta target if mentioned (e.g. "30 delta put")
  display: string;            // human-readable summary
}

const OPTIONS_PROMPT = (instruction: string) => `You are an expert options trader. Parse the following natural-language options instruction into a JSON object.

Known stock mappings: Apple → AAPL, Tesla → TSLA, Google/Alphabet → GOOGL, Microsoft → MSFT, Amazon → AMZN, Meta/Facebook → META, Netflix → NFLX, Nvidia → NVDA, AMD → AMD, Spotify → SPOT, Nike → NKE, Salesforce → CRM, Coinbase → COIN, Palantir → PLTR.

Output JSON with these fields:
- action: "buy" or "sell" (buy = long/directional, sell = short/income)
  - "buy a put" / "long put" / "I think it goes down" / "bearish on X" → buy put
  - "buy a call" / "long call" / "I think it goes up" / "bullish on X" → buy call
  - "sell a put" / "cash secured put" / "CSP" → sell put
  - "sell a call" / "covered call" / "CC" → sell call
- optionType: "put" or "call"
- symbol: uppercase ticker
- contracts: integer number of contracts (default 1 if not mentioned)
- strike: numeric strike price if mentioned, otherwise omit
- expiration: "YYYY-MM-DD" if a specific date is mentioned, otherwise omit
- dte: integer days to expiration if mentioned (e.g. "30 days out", "next month" → 30, "2 weeks" → 14, "next week" → 7), otherwise omit
- deltaTarget: decimal delta target if mentioned (e.g. "40 delta" → 0.40, "30 delta" → 0.30), otherwise omit
- display: short human-readable summary, e.g. "Buy 1 AAPL put (30 DTE, ~0.40 delta)"

Instruction: "${instruction}"

Respond with only valid JSON, no markdown, no explanation.`;

export async function parseOptionsInstruction(instruction: string): Promise<ParsedOptionsOrder> {
  const text = await callHaiku(OPTIONS_PROMPT(instruction), 512);
  const parsed = JSON.parse(text);

  if (!parsed.action || !parsed.optionType || !parsed.symbol) {
    throw new Error(
      'Could not parse options instruction — try something like "Buy 1 Apple put, 30 days out" or "I\'m bearish on Tesla, buy a put"'
    );
  }

  // Normalise contracts to integer ≥ 1
  parsed.contracts = Math.max(1, Math.round(Number(parsed.contracts) || 1));

  return parsed as ParsedOptionsOrder;
}
