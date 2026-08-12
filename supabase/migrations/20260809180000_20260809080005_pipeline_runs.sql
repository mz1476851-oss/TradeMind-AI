/*
# Pipeline run log (System Health visibility)

1. New Tables
- `pipeline_runs`
  - `id` (uuid, pk)
  - `job_name` (text) — 'fetch_market_data' | 'generate_signals' | 'check_open_trades'
  - `status` (text) — 'success' | 'error'
  - `summary` (jsonb) — short structured result (counts, errors) for display
  - `created_at` (timestamptz)

2. Why
- Every automated job now writes one row here when it finishes. The app reads
  this table to show a live "System Health" panel (last run time, what
  happened) directly in the UI — so checking on the system never again
  requires the Supabase dashboard, SQL Editor, or PowerShell.

3. Security
- RLS enabled. Any authenticated user can SELECT (system-wide operational
  status, not sensitive/per-user data). Only the service role (edge
  functions) can INSERT.
*/

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL CHECK (job_name IN ('fetch_market_data', 'generate_signals', 'check_open_trades')),
  status text NOT NULL CHECK (status IN ('success', 'error')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_pipeline_runs" ON pipeline_runs;
CREATE POLICY "read_pipeline_runs" ON pipeline_runs
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_job_recent
  ON pipeline_runs (job_name, created_at DESC);

-- Keep this table small automatically — only the last ~500 rows matter for a
-- status panel, no need to accumulate forever.
CREATE OR REPLACE FUNCTION trim_pipeline_runs() RETURNS trigger AS $$
BEGIN
  DELETE FROM pipeline_runs
  WHERE id IN (
    SELECT id FROM pipeline_runs
    ORDER BY created_at DESC
    OFFSET 500
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trim_pipeline_runs_trigger ON pipeline_runs;
CREATE TRIGGER trim_pipeline_runs_trigger
  AFTER INSERT ON pipeline_runs
  FOR EACH ROW
  WHEN (random() < 0.05) -- only run the cleanup occasionally, not on every insert
  EXECUTE FUNCTION trim_pipeline_runs();
