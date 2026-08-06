/*
# Schedule check-open-trades edge function via pg_cron

1. Overview
   Schedules the check-open-trades edge function to run every 5 minutes.
   It checks all open trades against latest market prices and closes
   any that hit stop-loss or take-profit, then updates PnL, virtual_capital,
   and creates portfolio snapshots.

2. Notes
   - Schedule: every 5 minutes.
   - Idempotent — re-running drops and recreates the job.
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_check_open_trades';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'trademind_check_open_trades',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://fxzeupdttciduovmelod.supabase.co/functions/v1/check-open-trades',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
