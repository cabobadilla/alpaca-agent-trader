import Alpaca from '@alpacahq/alpaca-trade-api';

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
  throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env');
}

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true, // always paper trading — set to false only for live
  feed: 'iex',  // free data feed
});

export default alpaca;
