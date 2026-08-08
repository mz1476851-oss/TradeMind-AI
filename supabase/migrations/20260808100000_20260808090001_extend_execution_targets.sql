/*
# Extend execution targets: add CoinDCX and 5paisa

1. Changes
- Widen `strategies.execution_target` CHECK to also allow 'coindcx_live' and 'fivepaisa_live'
  (previously only 'paper' and 'testnet_live').
- Widen `trades.execution_mode` CHECK to match.
- Add `trades.broker` (text) — records which broker actually executed a live trade
  ('binance_testnet' | 'coindcx' | 'fivepaisa' | null for paper trades).
- Add `trades.broker_order_ref` (text) — CoinDCX and 5paisa return string/UUID order
  identifiers, unlike Binance's numeric orderId (kept in the existing `broker_order_id`
  bigint column). This column holds those string refs.
- Index for finding unfilled CoinDCX/5paisa live trades that need a fill-sync pass.

2. Security
- This migration contains NO credentials of any kind. See the
  `user_broker_credentials` migration for how CoinDCX/5paisa keys are stored —
  always written at runtime via an edge function, never hardcoded here.
*/

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_execution_mode_check;
ALTER TABLE trades ADD CONSTRAINT trades_execution_mode_check
  CHECK (execution_mode IN ('paper', 'testnet_live', 'coindcx_live', 'fivepaisa_live'));

ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_execution_target_check;
ALTER TABLE strategies ADD CONSTRAINT strategies_execution_target_check
  CHECK (execution_target IN ('paper', 'testnet_live', 'coindcx_live', 'fivepaisa_live'));

ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_order_ref text;

CREATE INDEX IF NOT EXISTS idx_trades_live_unfilled
  ON trades (broker_order_ref)
  WHERE execution_mode IN ('coindcx_live', 'fivepaisa_live') AND broker_order_ref IS NOT NULL;
