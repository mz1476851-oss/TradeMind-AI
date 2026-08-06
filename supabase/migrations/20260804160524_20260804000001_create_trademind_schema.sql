/*
# TradeMind AI — Core Schema

1. Overview
   Full schema for a multi-market (stocks, crypto, forex) AI trading signal
   and paper-trading simulator. Simulation only — no real money or broker.

2. New Tables
   - users_profile: per-user settings (display name, virtual capital, risk
     tolerance, preferred markets). One row per auth user.
   - assets: tradable instruments across markets (reference data).
   - market_data: OHLCV candles per asset over time (reference data).
   - strategies: user-created trading strategies with indicators and risk.
   - signals: AI-generated trade signals tied to a strategy + asset.
   - trades: paper trades opened/closed by a user, with PnL.
   - portfolio_snapshots: time-series of total portfolio value per user.

3. Security
   - RLS enabled on every table.
   - Owner-scoped CRUD on users_profile, strategies, trades,
     portfolio_snapshots (auth.uid() = user_id).
   - assets + market_data are shared reference data: readable by
     authenticated users (SELECT only, no writes from the client).
   - signals are scoped through their parent strategy's owner.
   - All owner columns default to auth.uid() so inserts that omit the
     owner still satisfy WITH CHECK.

4. Notes
   - ON DELETE CASCADE ties child rows to their parents.
   - Indexes added for common query paths (user_id, asset_id, strategy_id).
*/

-- ============================================================
-- users_profile
-- ============================================================
CREATE TABLE IF NOT EXISTS users_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  virtual_capital numeric(18,2) NOT NULL DEFAULT 10000.00,
  risk_tolerance text NOT NULL DEFAULT 'medium'
    CHECK (risk_tolerance IN ('low','medium','high')),
  preferred_markets text[] NOT NULL DEFAULT ARRAY['stocks']::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON users_profile;
CREATE POLICY "select_own_profile" ON users_profile
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_profile" ON users_profile;
CREATE POLICY "insert_own_profile" ON users_profile
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_profile" ON users_profile;
CREATE POLICY "update_own_profile" ON users_profile
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_profile" ON users_profile;
CREATE POLICY "delete_own_profile" ON users_profile
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- assets (shared reference data)
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  market_type text NOT NULL
    CHECK (market_type IN ('stocks','crypto','forex')),
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_assets" ON assets;
CREATE POLICY "read_assets" ON assets
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- market_data (shared reference data)
-- ============================================================
CREATE TABLE IF NOT EXISTS market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  open numeric(18,6) NOT NULL,
  high numeric(18,6) NOT NULL,
  low numeric(18,6) NOT NULL,
  close numeric(18,6) NOT NULL,
  volume numeric(20,4) NOT NULL DEFAULT 0
);

ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_market_data" ON market_data;
CREATE POLICY "read_market_data" ON market_data
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_market_data_asset_time
  ON market_data (asset_id, timestamp DESC);

-- ============================================================
-- strategies
-- ============================================================
CREATE TABLE IF NOT EXISTS strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'trend',
  indicators_used text[] NOT NULL DEFAULT ARRAY[]::text[],
  risk_per_trade_pct numeric(5,2) NOT NULL DEFAULT 1.00
    CHECK (risk_per_trade_pct >= 0 AND risk_per_trade_pct <= 100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_strategies" ON strategies;
CREATE POLICY "select_own_strategies" ON strategies
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_strategies" ON strategies;
CREATE POLICY "insert_own_strategies" ON strategies
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_strategies" ON strategies;
CREATE POLICY "update_own_strategies" ON strategies
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_strategies" ON strategies;
CREATE POLICY "delete_own_strategies" ON strategies
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies (user_id);

-- ============================================================
-- signals (scoped through strategy owner)
-- ============================================================
CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type IN ('buy','sell','hold')),
  confidence_score numeric(5,2) NOT NULL DEFAULT 0
    CHECK (confidence_score >= 0 AND confidence_score <= 100),
  reasoning_text text NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_signals" ON signals;
CREATE POLICY "select_own_signals" ON signals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM strategies s
      WHERE s.id = signals.strategy_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_signals" ON signals;
CREATE POLICY "insert_own_signals" ON signals
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM strategies s
      WHERE s.id = signals.strategy_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_signals" ON signals;
CREATE POLICY "update_own_signals" ON signals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM strategies s
      WHERE s.id = signals.strategy_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM strategies s
      WHERE s.id = signals.strategy_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_own_signals" ON signals;
CREATE POLICY "delete_own_signals" ON signals
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM strategies s
      WHERE s.id = signals.strategy_id AND s.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_signals_strategy ON signals (strategy_id);
CREATE INDEX IF NOT EXISTS idx_signals_asset ON signals (asset_id);

-- ============================================================
-- trades
-- ============================================================
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES strategies(id) ON DELETE SET NULL,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  trade_type text NOT NULL CHECK (trade_type IN ('long','short')),
  entry_price numeric(18,6) NOT NULL,
  exit_price numeric(18,6),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  stop_loss numeric(18,6),
  take_profit numeric(18,6),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  is_paper_trade boolean NOT NULL DEFAULT true,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  pnl numeric(18,2) NOT NULL DEFAULT 0
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_trades" ON trades;
CREATE POLICY "select_own_trades" ON trades
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_trades" ON trades;
CREATE POLICY "insert_own_trades" ON trades
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_trades" ON trades;
CREATE POLICY "update_own_trades" ON trades
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_trades" ON trades;
CREATE POLICY "delete_own_trades" ON trades
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trades_user ON trades (user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);

-- ============================================================
-- portfolio_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL DEFAULT now(),
  total_value numeric(18,2) NOT NULL DEFAULT 0,
  cash_balance numeric(18,2) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(18,2) NOT NULL DEFAULT 0
);

ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_snapshots" ON portfolio_snapshots;
CREATE POLICY "select_own_snapshots" ON portfolio_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_snapshots" ON portfolio_snapshots;
CREATE POLICY "insert_own_snapshots" ON portfolio_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_snapshots" ON portfolio_snapshots;
CREATE POLICY "update_own_snapshots" ON portfolio_snapshots
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_snapshots" ON portfolio_snapshots;
CREATE POLICY "delete_own_snapshots" ON portfolio_snapshots
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_time
  ON portfolio_snapshots (user_id, timestamp DESC);
