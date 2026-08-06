/*
# Add signal_term column to signals table

1. Overview
   The generate-signals edge function produces both short-term and long-term
   signals. We need a column to distinguish them, and strategy_id must become
   nullable since signals can be generated system-wide without a user strategy.

2. Changes
   - Add `signal_term` column to `signals` (values: short_term, long_term).
   - Add CHECK constraint on signal_term.
   - Make `strategy_id` nullable (signals can be system-generated).
   - Backfill existing rows to 'short_term' default.
   - Add index on signal_term for filtering.

3. Security
   - No policy changes needed; existing owner-scoped SELECT through strategies
     still applies. However, system-generated signals have no strategy_id, so
     we add a new SELECT policy allowing authenticated users to read any signal
     where strategy_id IS NULL (system-generated signals are shared reference
     data, like assets and market_data).
   - INSERT remains owner-scoped through strategies.
*/

-- Add signal_term column with default
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS signal_term text NOT NULL DEFAULT 'short_term'
    CHECK (signal_term IN ('short_term','long_term'));

-- Make strategy_id nullable for system-generated signals
ALTER TABLE signals ALTER COLUMN strategy_id DROP NOT NULL;

-- Index for filtering by term
CREATE INDEX IF NOT EXISTS idx_signals_term ON signals (signal_term);

-- Add a SELECT policy for system-generated (shared) signals with no strategy
DROP POLICY IF EXISTS "select_system_signals" ON signals;
CREATE POLICY "select_system_signals" ON signals
  FOR SELECT TO authenticated
  USING (strategy_id IS NULL);
