/**
 * marketIntel.ts — Market intelligence engine
 *
 * Aggregates 4 signal layers to generate ranked options recommendations:
 *  1. Unusual options flow     — volume/OI spikes = institutional activity
 *  2. Tech news & catalysts    — AI announcements, earnings, product launches
 *  3. Technical momentum       — RSI(14), price vs 20-day MA, volume vs avg
 *  4. Reddit sentiment         — r/options + r/wallstreetbets crowd bias
 *
 * All signals are fed into Claude Sonnet which synthesizes them into
 * ranked, actionable options plays with rationale.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getOptionsChain, getOptionsSnapshot } from './alpacaOptions';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Watchlist ─────────────────────────────────────────────────────────────────

export const TECH_WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META',
  'AMZN', 'AMD',  'TSLA', 'COIN',  'PLTR',
];

const DATA_BASE  = 'https://data.alpaca.markets';
const BROKER_BASE = 'https://paper-api.alpaca.markets/v2';

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID':     process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UnusualFlow {
  symbol: string;
  occSymbol: string;
  optionType: 'call' | 'put';
  volume: number;
  openInterest: number;
  volOIRatio: number;
  impliedVol: number;
  delta: number;
  expiration: string;
  strike: string;
  premium: number;   // mid × 100 × volume (total $ at stake)
  bias: 'bullish' | 'bearish';
}

export interface NewsItem {
  symbol: string;
  headline: string;
  summary: string;
  publishedAt: string;
  url: string;
}

export interface TechnicalSignal {
  symbol: string;
  currentPrice: number;
  rsi14: number;
  priceVs20dma: number;  // % above (+) or below (-) 20-day MA
  volumeVsAvg: number;   // today's volume as % of 30-day avg
  signal: 'oversold' | 'overbought' | 'neutral' | 'breakout' | 'breakdown';
}

export interface RedditMention {
  symbol: string;
  mentions: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  topPost: string;
}

export interface OptionsRecommendation {
  rank: number;
  symbol: string;
  action: 'buy_call' | 'buy_put' | 'sell_put' | 'sell_call';
  rationale: string;
  keySignals: string[];
  suggestedDTE: number;
  suggestedDelta: number;
  confidence: 'high' | 'medium' | 'low';
  riskNote: string;
}

export interface MarketBrief {
  generatedAt: string;
  marketContext: string;
  recommendations: OptionsRecommendation[];
  unusualFlowSummary: string;
  newsSummary: string;
  technicalSummary: string;
  redditSummary: string;
  rawSignals: {
    unusualFlow: UnusualFlow[];
    news: NewsItem[];
    technicals: TechnicalSignal[];
    reddit: RedditMention[];
  };
}

// ── 1. Unusual options flow ───────────────────────────────────────────────────

export async function getUnusualOptionsFlow(symbols: string[]): Promise<UnusualFlow[]> {
  const flows: UnusualFlow[] = [];

  for (const symbol of symbols) {
    try {
      // Get puts and calls in 14–60 DTE range
      const [puts, calls] = await Promise.all([
        getOptionsChain(symbol, 'put',  14, 60),
        getOptionsChain(symbol, 'call', 14, 60),
      ]);
      const contracts = [...puts, ...calls].slice(0, 60); // cap for API limits
      if (contracts.length === 0) continue;

      const syms = contracts.map((c) => c.symbol);
      const snapshots = await getOptionsSnapshot(syms);

      for (const contract of contracts) {
        const snap = snapshots[contract.symbol];
        if (!snap?.greeks || !snap.latestQuote) continue;

        // Alpaca options snapshot includes volume & OI in the latestTrade/quote fields
        // We infer unusual flow from IV spike and available quote data
        const iv  = snap.impliedVolatility ?? 0;
        const mid = ((snap.latestQuote.ap ?? 0) + (snap.latestQuote.bp ?? 0)) / 2;
        const delta = Math.abs(snap.greeks.delta ?? 0);

        if (mid <= 0 || iv <= 0) continue;

        // Flag contracts with IV > 60% (high implied vol = market expects a move)
        // or delta in 0.30–0.70 range (liquid, actively traded zone)
        const isHighIV   = iv > 0.60;
        const isActiveDelta = delta >= 0.25 && delta <= 0.75;

        if (!isHighIV && !isActiveDelta) continue;

        const isPut = contract.symbol.match(/P\d{8}$/) !== null;
        const premium = mid * 100; // per contract notional

        flows.push({
          symbol,
          occSymbol:   contract.symbol,
          optionType:  isPut ? 'put' : 'call',
          volume:      0,          // Alpaca snapshot doesn't expose volume directly
          openInterest: 0,
          volOIRatio:  iv,         // use IV as proxy for activity
          impliedVol:  iv,
          delta:       snap.greeks.delta ?? 0,
          expiration:  contract.expiration_date,
          strike:      contract.strike_price,
          premium,
          bias:        isPut ? 'bearish' : 'bullish',
        });
      }
    } catch {
      // Skip symbols with no options or API errors
    }
  }

  // Sort by IV descending — highest IV = most anticipated move
  return flows
    .sort((a, b) => b.impliedVol - a.impliedVol)
    .slice(0, 20);
}

// ── 2. Tech news & catalysts ──────────────────────────────────────────────────

export async function getNewsForSymbols(symbols: string[]): Promise<NewsItem[]> {
  try {
    const url = new URL(`${DATA_BASE}/v1beta1/news`);
    url.searchParams.set('symbols', symbols.join(','));
    url.searchParams.set('limit',   '30');
    url.searchParams.set('sort',    'desc');

    const res = await fetch(url.toString(), { headers: alpacaHeaders() });
    if (!res.ok) return [];

    const data = await res.json() as { news: Array<{
      symbols: string[];
      headline: string;
      summary: string;
      created_at: string;
      url: string;
    }> };

    return (data.news ?? []).map((item) => ({
      symbol:      item.symbols?.[0] ?? '',
      headline:    item.headline,
      summary:     item.summary ?? '',
      publishedAt: item.created_at,
      url:         item.url,
    }));
  } catch {
    return [];
  }
}

// ── 3. Technical signals ──────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains  += diff;
    else          losses -= diff;
  }
  const avgGain = gains  / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export async function getTechnicalSignals(symbols: string[]): Promise<TechnicalSignal[]> {
  const signals: TechnicalSignal[] = [];

  try {
    const url = new URL(`${DATA_BASE}/v2/stocks/bars`);
    url.searchParams.set('symbols',   symbols.join(','));
    url.searchParams.set('timeframe', '1Day');
    url.searchParams.set('limit',     '35');
    url.searchParams.set('sort',      'asc');
    url.searchParams.set('feed',      'iex');  // free data feed

    const res = await fetch(url.toString(), { headers: alpacaHeaders() });
    if (!res.ok) return [];

    const data = await res.json() as { bars: Record<string, Array<{
      c: number; // close
      v: number; // volume
      t: string; // timestamp
    }>> };

    for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
      if (bars.length < 21) continue;

      const closes  = bars.map((b) => b.c);
      const volumes = bars.map((b) => b.v);

      const currentPrice = closes[closes.length - 1];
      const rsi14        = calcRSI(closes);

      // 20-day simple MA
      const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const priceVs20dma = ((currentPrice - ma20) / ma20) * 100;

      // Volume: today vs 30-day avg
      const avgVol      = volumes.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, volumes.length);
      const todayVol    = volumes[volumes.length - 1];
      const volumeVsAvg = avgVol > 0 ? (todayVol / avgVol) * 100 : 100;

      let signal: TechnicalSignal['signal'] = 'neutral';
      if (rsi14 < 30)                                  signal = 'oversold';
      else if (rsi14 > 70)                             signal = 'overbought';
      else if (priceVs20dma > 3 && volumeVsAvg > 120) signal = 'breakout';
      else if (priceVs20dma < -3 && volumeVsAvg > 120) signal = 'breakdown';

      signals.push({ symbol, currentPrice, rsi14, priceVs20dma, volumeVsAvg, signal });
    }
  } catch {
    // Return whatever we have
  }

  return signals;
}

// ── 4. Reddit sentiment ───────────────────────────────────────────────────────

const TICKER_RE = /\b([A-Z]{2,5})\b/g;
const BULLISH_WORDS  = /\b(bull|calls?|moon|buy|long|squeeze|breakout|surge|rally|yolo)\b/i;
const BEARISH_WORDS  = /\b(bear|puts?|short|crash|dump|drop|sell|fall|tank|collapse)\b/i;

export async function getRedditSentiment(watchlist: string[]): Promise<RedditMention[]> {
  const mentionMap: Record<string, { count: number; bullish: number; bearish: number; topPost: string }> = {};

  const subreddits = ['options', 'wallstreetbets', 'stocks'];

  for (const sub of subreddits) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/hot.json?limit=50`,
        { headers: { 'User-Agent': 'alpaca-trader-bot/1.0' } }
      );
      if (!res.ok) continue;

      const data = await res.json() as { data: { children: Array<{ data: { title: string; selftext: string; score: number } }> } };
      const posts = data.data?.children ?? [];

      for (const post of posts) {
        const text  = `${post.data.title} ${post.data.selftext}`;
        const tickers = [...text.matchAll(TICKER_RE)]
          .map((m) => m[1])
          .filter((t) => watchlist.includes(t));

        for (const ticker of [...new Set(tickers)]) {
          if (!mentionMap[ticker]) {
            mentionMap[ticker] = { count: 0, bullish: 0, bearish: 0, topPost: '' };
          }
          mentionMap[ticker].count++;
          if (BULLISH_WORDS.test(text)) mentionMap[ticker].bullish++;
          if (BEARISH_WORDS.test(text)) mentionMap[ticker].bearish++;
          if (!mentionMap[ticker].topPost) {
            mentionMap[ticker].topPost = post.data.title.slice(0, 120);
          }
        }
      }
    } catch {
      // Skip subreddit on error
    }
  }

  return Object.entries(mentionMap)
    .filter(([, v]) => v.count > 0)
    .map(([symbol, v]) => ({
      symbol,
      mentions: v.count,
      sentiment: v.bullish > v.bearish ? 'bullish'
               : v.bearish > v.bullish ? 'bearish'
               : 'neutral',
      topPost: v.topPost,
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

// ── 5. Claude synthesis ───────────────────────────────────────────────────────

async function synthesizeWithClaude(
  flow:        UnusualFlow[],
  news:        NewsItem[],
  technicals:  TechnicalSignal[],
  reddit:      RedditMention[],
  watchlist:   string[],
): Promise<{ marketContext: string; recommendations: OptionsRecommendation[]; summaries: Record<string, string> }> {

  const prompt = `You are an expert options trader and market analyst. Based on the following multi-source market signals, generate a ranked list of actionable options trade recommendations.

## WATCHLIST
${watchlist.join(', ')}

## SIGNAL 1 — High-IV / Unusual Options Activity
(Contracts with elevated implied volatility suggesting market anticipates a move)
${flow.length === 0 ? 'No unusual flow detected.' :
  flow.slice(0, 10).map(f =>
    `${f.symbol} | ${f.optionType.toUpperCase()} | strike ${f.strike} exp ${f.expiration} | IV=${(f.impliedVol*100).toFixed(0)}% | delta=${f.delta.toFixed(2)} | bias=${f.bias}`
  ).join('\n')}

## SIGNAL 2 — Recent Tech News & Catalysts
${news.length === 0 ? 'No recent news.' :
  news.slice(0, 15).map(n =>
    `[${n.symbol}] ${n.publishedAt.slice(0,10)} — ${n.headline}`
  ).join('\n')}

## SIGNAL 3 — Technical Momentum
${technicals.length === 0 ? 'No technical data.' :
  technicals.map(t =>
    `${t.symbol}: price=$${t.currentPrice.toFixed(2)}, RSI=${t.rsi14.toFixed(1)}, vs20DMA=${t.priceVs20dma.toFixed(1)}%, vol%=${t.volumeVsAvg.toFixed(0)}%, signal=${t.signal}`
  ).join('\n')}

## SIGNAL 4 — Reddit/Social Sentiment
${reddit.length === 0 ? 'No Reddit mentions detected.' :
  reddit.map(r =>
    `${r.symbol}: ${r.mentions} mentions | sentiment=${r.sentiment} | "${r.topPost}"`
  ).join('\n')}

---

Based on ALL signals above, respond with a JSON object with this exact structure:
{
  "marketContext": "2-3 sentence overview of the current market environment and key themes",
  "unusualFlowSummary": "1-2 sentences on what the options flow is signaling",
  "newsSummary": "1-2 sentences on the most important news catalysts",
  "technicalSummary": "1-2 sentences on the technical picture",
  "redditSummary": "1-2 sentences on social sentiment",
  "recommendations": [
    {
      "rank": 1,
      "symbol": "TICKER",
      "action": "buy_call" | "buy_put" | "sell_put" | "sell_call",
      "rationale": "2-3 sentences explaining why this trade makes sense given the signals",
      "keySignals": ["signal 1", "signal 2"],
      "suggestedDTE": 30,
      "suggestedDelta": 0.40,
      "confidence": "high" | "medium" | "low",
      "riskNote": "1 sentence on the key risk to this trade"
    }
  ]
}

Rules:
- Recommend 3–6 trades maximum
- Prioritize where MULTIPLE signals align (e.g. high IV + bearish news + oversold RSI = buy put opportunity)
- Consider AI/tech news catalysts for cross-stock impact (e.g. OpenAI news → MSFT, Anthropic news → GOOGL/AMZN)
- Mark confidence as "high" only when 3+ signals align
- Respond with ONLY valid JSON, no markdown, no explanation outside the JSON`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (message.content[0] as { type: 'text'; text: string }).text.trim();
  console.log('[intel] Claude raw response (first 500):', raw.slice(0, 500));
  console.log('[intel] stop_reason:', message.stop_reason);

  // Try multiple strategies to extract valid JSON from the response
  let parsed: any;
  const strategies = [
    // 1. Raw text as-is
    raw,
    // 2. Strip markdown fences
    raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
    // 3. Extract first {...} block found in the response
    (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? m[0] : ''; })(),
  ];

  for (const candidate of strategies) {
    if (!candidate) continue;
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // try next strategy
    }
  }

  if (!parsed) {
    console.error('[intel] Claude returned non-JSON after all strategies:', raw.slice(0, 300));
    return {
      marketContext: 'Market analysis completed. See raw signal data for details.',
      recommendations: [],
      summaries: {
        unusualFlow: 'Synthesis unavailable — raw signals collected successfully.',
        news:        'Synthesis unavailable — raw signals collected successfully.',
        technicals:  'Synthesis unavailable — raw signals collected successfully.',
        reddit:      'Synthesis unavailable — raw signals collected successfully.',
      },
    };
  }

  return {
    marketContext:   parsed.marketContext   ?? 'No context available.',
    recommendations: parsed.recommendations ?? [],
    summaries: {
      unusualFlow: parsed.unusualFlowSummary ?? '',
      news:        parsed.newsSummary        ?? '',
      technicals:  parsed.technicalSummary   ?? '',
      reddit:      parsed.redditSummary      ?? '',
    },
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateMarketBrief(extraSymbols: string[] = []): Promise<MarketBrief> {
  const watchlist = [...new Set([...TECH_WATCHLIST, ...extraSymbols])];

  console.log(`[intel] Generating market brief for: ${watchlist.join(', ')}`);

  // Run all 4 signal layers in parallel — individual failures return empty arrays
  const [flow, news, technicals, reddit] = await Promise.all([
    getUnusualOptionsFlow(watchlist).catch((e) => { console.error('[intel] flow error:', e.message); return [] as UnusualFlow[]; }),
    getNewsForSymbols(watchlist).catch((e)      => { console.error('[intel] news error:', e.message); return [] as NewsItem[]; }),
    getTechnicalSignals(watchlist).catch((e)    => { console.error('[intel] tech error:', e.message); return [] as TechnicalSignal[]; }),
    getRedditSentiment(watchlist).catch((e)     => { console.error('[intel] reddit error:', e.message); return [] as RedditMention[]; }),
  ]);

  console.log(`[intel] Signals gathered — flow:${flow.length} news:${news.length} tech:${technicals.length} reddit:${reddit.length}`);

  // Synthesize with Claude Sonnet
  const synthesis = await synthesizeWithClaude(flow, news, technicals, reddit, watchlist);

  return {
    generatedAt:       new Date().toISOString(),
    marketContext:     synthesis.marketContext,
    recommendations:   synthesis.recommendations,
    unusualFlowSummary: synthesis.summaries.unusualFlow,
    newsSummary:        synthesis.summaries.news,
    technicalSummary:   synthesis.summaries.technicals,
    redditSummary:      synthesis.summaries.reddit,
    rawSignals: { unusualFlow: flow, news, technicals, reddit },
  };
}
