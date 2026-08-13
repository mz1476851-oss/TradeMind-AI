/*
# Simplify cron auth: use a database setting instead of Vault

1. Why
- Vault's create_secret/update_secret function signatures didn't match what
  this project's Postgres/Vault extension version expects, and direct
  UPDATE on vault.secrets is blocked by design. Rather than keep fighting
  Vault's API, this uses a plain Postgres database-level custom setting
  (ALTER DATABASE ... SET), which is simpler, has no special function
  signature to get right, and is only readable by roles that can already
  run SQL against this database (same trust boundary Vault would have had).

2. REQUIRED MANUAL STEP BEFORE THIS MIGRATION WILL WORK
- Run this once in the SQL Editor, with your own real service_role key
  (Settings -> API -> service_role, NOT the anon key). Replace only the
  placeholder text between the quotes:

    alter database postgres set app.settings.service_role_key = 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

  Then run: select pg_reload_conf();

  Do this yourself and don't share the key in chat.

3. Changes
- Re-points all three cron jobs to build their Authorization header from
  current_setting('app.settings.service_role_key') instead of a Vault
  lookup.
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
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
