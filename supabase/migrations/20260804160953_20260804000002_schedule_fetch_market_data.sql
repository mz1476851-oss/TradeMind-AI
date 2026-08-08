/*
# Schedule fetch-market-data edge function via pg_cron

1. Overview
   Schedules the fetch-market-data Supabase Edge Function to run every 10
   minutes using the pg_cron extension. The function fetches latest prices
   for crypto, stocks, and forex and inserts snapshots into market_data.

2. Changes
   - Ensures pg_cron and pg_net extensions are installed.
   - Creates a scheduled job named trademind_fetch_market_data.
   - The job calls the edge function via net.http_post.

3. Notes
   - Schedule: every 10 minutes.
   - The job is idempotent — re-running drops and recreates it.
   - The edge function has verify_jwt disabled, so no auth header needed.
     The function reads SUPABASE_SERVICE_ROLE_KEY from its own env to
     perform the privileged DB insert.
*/

-- Ensure extensions exist
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Remove existing job if present (idempotent)
DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_fetch_market_data';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

-- Schedule the edge function call every 10 minutes.
SELECT cron.schedule(
  'trademind_fetch_market_data',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/fetch-market-data',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
