/*
# Add paper trading execution fields

1. Overview
   Extends the schema to support automated paper trading: strategy
   configuration (auto-trade, confidence threshold, watched markets),
   trade lifecycle (pending suggestions, signal linkage), and risk
   guardrails (max concurrent positions, daily loss tracking).

2. Changes to strategies table
   - auto_trade boolean (default false): if true, system auto-opens trades;
     if false, signals become pending suggestions for manual approval.
   - confidence_threshold numeric (default 60): minimum confidence score
     for a signal to trigger trade execution.
   - watched_markets text[]: which markets the strategy watches (stocks,
     crypto, forex). If empty, watches all.
   - watched_asset_ids uuid[]: specific asset IDs to watch. If empty,
     watches all assets in the watched_markets.

3. Changes to trades table
   - signal_id uuid: link to the signal that triggered the trade.
   - status now includes 'pending' (suggestion awaiting approval).
   - Add CHECK constraint for status values including 'pending'.
   - Add rejected_at timestamp for manual rejection tracking.
   - Add daily_loss_pct numeric on users_profile for daily loss limit.

4. Changes to users_profile table
   - max_concurrent_positions int (default 5): max open trades per user.
   - daily_loss_limit_pct numeric (default 5): max daily loss percentage
     before auto-trading pauses for the day.

5. Security
   - No new tables; existing RLS policies cover all new columns.
   - watched_asset_ids references are soft (no FK) since assets are shared.
*/

-- ---- strategies: new columns ----
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS auto_trade boolean NOT NULL DEFAULT false;

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS confidence_threshold numeric(5,2) NOT NULL DEFAULT 60.00
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 100);

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS watched_markets text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS watched_asset_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

-- ---- trades: new columns + status constraint ----
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS signal_id uuid;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- Drop old constraint and add expanded one (includes 'pending')
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_status_check;
ALTER TABLE trades ADD CONSTRAINT trades_status_check
  CHECK (status IN ('pending','open','closed','cancelled'));

-- Index for finding pending trades by user
CREATE INDEX IF NOT EXISTS idx_trades_pending_user
  ON trades (user_id) WHERE status = 'pending';

-- Index for signal linkage
CREATE INDEX IF NOT EXISTS idx_trades_signal ON trades (signal_id);

-- ---- users_profile: risk guardrails ----
ALTER TABLE users_profile
  ADD COLUMN IF NOT EXISTS max_concurrent_positions int NOT NULL DEFAULT 5
    CHECK (max_concurrent_positions > 0 AND max_concurrent_positions <= 50);

ALTER TABLE users_profile
  ADD COLUMN IF NOT EXISTS daily_loss_limit_pct numeric(5,2) NOT NULL DEFAULT 5.00
    CHECK (daily_loss_limit_pct >= 0 AND daily_loss_limit_pct <= 100);
