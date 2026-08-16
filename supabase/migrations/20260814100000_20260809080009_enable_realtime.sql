/*
# Enable Supabase Realtime for live-updating UI

1. Why
- The app currently polls (every 30-60s) for new prices, trades, and
  notifications. Adding these tables to the realtime publication lets the
  frontend subscribe instead — updates appear the instant they're written,
  not on the next poll cycle. This is what makes charts, the live P&L, and
  notifications feel like a real trading platform instead of a page that
  refreshes periodically.

2. Changes
- Adds market_data, trades, notifications, and pipeline_runs to the
  supabase_realtime publication.
- RLS policies already in place on these tables continue to govern exactly
  what each subscriber can see over realtime -- this only affects delivery,
  not access.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'market_data'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE market_data;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trades;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pipeline_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_runs;
  END IF;
END $$;
