/*
# Fix the strategy-accuracy cron job (same class of bug as before)

1. The problem
- The daily "recalculate-strategy-accuracy-daily" cron job has always
  referenced current_setting('app.supabase_url') and
  current_setting('app.service_role_key') -- database settings that were
  never actually configured on this project. This job has been failing
  silently since day one, so strategy_accuracy has stayed empty/stale,
  and the Backtest page never had real data to show.

2. The fix
- Re-point it to use get_service_role_key() (the working function created
  earlier) and the real project URL, matching the other three cron jobs.
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'recalculate-strategy-accuracy-daily';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;
END $$;

SELECT cron.schedule(
  'recalculate-strategy-accuracy-daily',
  '0 1 * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/generate-signals',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key()
      ),
      body := jsonb_build_object('backtest_only', true)
    );
  $$
);
