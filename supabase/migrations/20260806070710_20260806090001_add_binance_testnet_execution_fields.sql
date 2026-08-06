-- Add execution_mode and broker_order_id to trades table
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'paper'
    CHECK (execution_mode IN ('paper', 'testnet_live'));

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS broker_order_id bigint;

-- Add execution_target to strategies table
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS execution_target text NOT NULL DEFAULT 'paper'
    CHECK (execution_target IN ('paper', 'testnet_live'));

-- Index for finding testnet trades that need fill sync
CREATE INDEX IF NOT EXISTS idx_trades_testnet_unfilled
  ON trades (broker_order_id) WHERE execution_mode = 'testnet_live' AND broker_order_id IS NOT NULL;
