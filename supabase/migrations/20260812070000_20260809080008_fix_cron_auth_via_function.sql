/*
# Cron auth via a dedicated SQL function (final approach)

1. Why this approach
- Direct UPDATE on vault.secrets is blocked by Supabase's own policies.
- ALTER DATABASE ... SET is blocked because the project's Postgres role
  isn't a superuser on Supabase's managed platform.
- Creating a plain SQL function IS always permitted for the project owner
  role, and access to it can be locked down with REVOKE/GRANT -- so this is
  the reliable option.

2. REQUIRED MANUAL STEP BEFORE THIS MIGRATION WILL WORK
- In the SQL Editor, run this once yourself (don't share the key in chat):

    create or replace function get_service_role_key() returns text
    language sql
    security definer
    set search_path = public
    as $$
      select 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE'::text;
    $$;

    revoke execute on function get_service_role_key() from public, anon, authenticated;

  Get the key from Settings -> API -> service_role (NOT the anon key).

3. Changes
- Re-points all three cron jobs to build their Authorization header by
  calling get_service_role_key() instead of Vault or a database setting.
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
        'Authorization', 'Bearer ' || get_service_role_key()
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
        'Authorization', 'Bearer ' || get_service_role_key()
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
        'Authorization', 'Bearer ' || get_service_role_key()
      ),
      body := '{}'::jsonb
    );
  $$
);
