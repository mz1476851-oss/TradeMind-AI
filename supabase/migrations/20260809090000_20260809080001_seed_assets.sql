/*
# Seed initial tradable assets

1. Why
- The assets table ships empty by default — nothing seeds it in the base schema
  migration. Without rows here, fetch-market-data has nothing to fetch prices
  for and generate-signals has nothing to score, so both silently report 0
  results (this is why a fresh project shows "Updated 0 price snapshots").

2. Symbol format notes (matches existing fetch-market-data code as-is)
- Crypto: "<TICKER>/USD" — matches the CoinGecko lookup table in fetch-market-data.
  Converted to a Binance/CoinDCX-style pair (e.g. "BTCUSDT") at order-placement time.
- Stocks: "<TICKER>/USD" — fetch-market-data strips the "/USD" before calling
  Twelve Data.
- Forex: "<BASE>/<QUOTE>" — matches exchangerate.host's base/quote pairs.

3. This migration only inserts reference data (symbol/name/market_type).
  No prices, no credentials.
*/

INSERT INTO assets (symbol, market_type, name) VALUES
  ('BTC/USD', 'crypto', 'Bitcoin'),
  ('ETH/USD', 'crypto', 'Ethereum'),
  ('SOL/USD', 'crypto', 'Solana'),
  ('BNB/USD', 'crypto', 'BNB'),
  ('XRP/USD', 'crypto', 'XRP'),
  ('AAPL/USD', 'stocks', 'Apple Inc.'),
  ('MSFT/USD', 'stocks', 'Microsoft Corp.'),
  ('GOOGL/USD', 'stocks', 'Alphabet Inc.'),
  ('AMZN/USD', 'stocks', 'Amazon.com Inc.'),
  ('TSLA/USD', 'stocks', 'Tesla Inc.'),
  ('EUR/USD', 'forex', 'Euro / US Dollar'),
  ('GBP/USD', 'forex', 'British Pound / US Dollar'),
  ('USD/JPY', 'forex', 'US Dollar / Japanese Yen')
ON CONFLICT DO NOTHING;
