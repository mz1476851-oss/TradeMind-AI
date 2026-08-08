/*
# Schedule generate-signals edge function via pg_cron

1. Overview
   Schedules the generate-signals edge function to run every 10 minutes,
   offset by 2 minutes from the fetch-market-data job so that fresh price
   data is available when signals are calculated.

2. Changes
   - Creates a scheduled job named trademind_generate_signals.
   - Schedule: 2nd, 12th, 22nd, 32nd, 42nd, 52nd minute of each hour.
   - The job is idempotent — re-running drops and recreates it.

3. Notes
   - The edge function has verify_jwt disabled; it uses the service role
     key from its own env to read market_data and write to signals.
   - fetch-market-data runs at minutes 0,10,20,30,40,50.
   - generate-signals runs at minutes 2,12,22,32,42,52 — 2 minutes later.
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_generate_signals';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'trademind_generate_signals',
  '2-59/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/generate-signals',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
