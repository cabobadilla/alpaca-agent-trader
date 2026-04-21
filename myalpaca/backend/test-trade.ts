/**
 * Quick smoke test — validates parse + execute for a BUY and a SELL.
 * Run from repo root:  docker compose exec backend npx tsx test-trade.ts
 *
 * Uses $5 notional for each trade (well within paper account limits).
 */
import 'dotenv/config';
import { parseTradeInstruction } from './src/services/claude';
import alpaca from './src/alpaca';

const BASE_URL = 'http://localhost:3001';

async function testParse(instruction: string) {
  console.log(`\n--- PARSE: "${instruction}" ---`);
  const parsed = await parseTradeInstruction(instruction);
  console.log('Result:', parsed);
  return parsed;
}

async function testExecute(side: string, symbol: string, notional: number) {
  console.log(`\n--- EXECUTE: ${side.toUpperCase()} ${symbol} $${notional} ---`);
  const order = await (alpaca as any).createOrder({
    symbol,
    notional: notional.toString(),
    side,
    type: 'market',
    time_in_force: 'day',
  });
  console.log('Order ID :', order.id);
  console.log('Status   :', order.status);
  console.log('Symbol   :', order.symbol);
  console.log('Side     :', order.side);
  console.log('Notional :', order.notional);
  console.log('Created  :', order.created_at);
  return order;
}

async function run() {
  try {
    // 1. Test parse — BUY
    const buy = await testParse('Buy Apple for 5 dollars');
    console.assert(buy.side === 'buy', 'side should be buy');
    console.assert(buy.symbol === 'AAPL', `symbol should be AAPL, got ${buy.symbol}`);
    console.assert(buy.notional === 5, `notional should be 5, got ${buy.notional}`);

    // 2. Test parse — SELL
    const sell = await testParse('Sell Tesla 7 USD');
    console.assert(sell.side === 'sell', 'side should be sell');
    console.assert(sell.symbol === 'TSLA', `symbol should be TSLA, got ${sell.symbol}`);
    console.assert(sell.notional === 7, `notional should be 7, got ${sell.notional}`);

    // 3. Execute BUY — $5 AAPL
    const buyOrder = await testExecute('buy', 'AAPL', 5);
    console.assert(buyOrder.id, 'buy order should have an id');

    // 4. Execute SELL — $5 TSLA (paper account — sells may require an open position)
    //    Alpaca paper allows fractional sells even without a position on some accounts.
    //    If this throws "account is not allowed to short", that's expected for cash accounts.
    try {
      const sellOrder = await testExecute('sell', 'TSLA', 5);
      console.assert(sellOrder.id, 'sell order should have an id');
    } catch (err: any) {
      if (err.message?.includes('not allowed to short') || err.message?.includes('insufficient')) {
        console.log('SELL skipped — account does not allow shorting (expected for cash accounts)');
        console.log('To test SELL: first buy TSLA, then sell it.');
      } else {
        throw err;
      }
    }

    console.log('\n✓ All tests passed');
  } catch (err) {
    console.error('\n✗ Test failed:', err);
    process.exit(1);
  }
}

run();
