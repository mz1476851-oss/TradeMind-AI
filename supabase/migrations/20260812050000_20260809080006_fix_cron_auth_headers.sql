/*
# Fix cron jobs: add missing Authorization header (root cause of "0 inserted" runs)

1. The problem
- All three cron jobs (fetch_market_data, generate_signals, check_open_trades)
  have called their edge functions via net.http_post WITHOUT an Authorization
  header, since the very first migration that created them.
- Edge functions require a valid Authorization header by default. Every
  automatic cron-triggered call has been getting rejected with 401
  Unauthorized -- invisible in cron.job_run_details, because that table only
  reflects whether the SQL call to queue the HTTP request succeeded, not
  whether the HTTP request itself got a 200. This is why the app only ever
  collected real data during the manual PowerShell test runs (which included
  a valid Bearer token), never automatically.

2. The fix
- Store the service role key in Supabase Vault (encrypted at rest, not
  visible in migration files or git) and have each cron job pull it at
  call-time to build a proper Authorization header.

3. REQUIRED MANUAL STEP BEFORE THIS MIGRATION WILL WORK
- Run this once in the SQL Editor, with your own real service_role key
  (Settings -> API -> service_role, NOT the anon key):

    select vault.create_secret('PASTE_YOUR_SERVICE_ROLE_KEY_HERE', 'service_role_key');

  Do this in a query you run yourself and don't share -- this key should
  never be pasted into chat or committed to a file.
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_fetch_market_data';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_generate_signals';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_check_open_trades';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;
END $$;

SELECT cron.schedule(
  'trademind_fetch_market_data',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/fetch-market-data',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'trademind_generate_signals',
  '2-59/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/generate-signals',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'trademind_check_open_trades',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/check-open-trades',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
