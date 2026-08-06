-- Add risk_note column to signals table
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS risk_note text,
  ADD COLUMN IF NOT EXISTS recommended_confidence integer;

-- Create strategy_accuracy table
CREATE TABLE IF NOT EXISTS strategy_accuracy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  signal_term text NOT NULL DEFAULT 'short_term',
  lookback_days integer NOT NULL DEFAULT 90,
  win_rate_pct numeric(5,2) NOT NULL DEFAULT 0,
  avg_return_pct numeric(8,4) NOT NULL DEFAULT 0,
  total_signals_tested integer NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, signal_term, lookback_days)
);

ALTER TABLE strategy_accuracy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_accuracy" ON strategy_accuracy FOR SELECT
  TO authenticated USING (true);

-- Only service role can insert/update (edge function writes these)
-- No INSERT/UPDATE/DELETE policies for authenticated users

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_strategy_accuracy_asset_term
  ON strategy_accuracy (asset_id, signal_term, lookback_days);

-- Schedule daily recalculation of strategy accuracy
SELECT cron.schedule(
  'recalculate-strategy-accuracy-daily',
  '0 1 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/generate-signals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('backtest_only', true)
  );
  $$
);
