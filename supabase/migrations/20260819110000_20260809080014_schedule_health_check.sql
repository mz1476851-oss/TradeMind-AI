/*
# Schedule active pipeline health checks every 5 minutes
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_check_pipeline_health';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;
END $$;

SELECT cron.schedule(
  'trademind_check_pipeline_health',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ddtyutgxwesaofnmksvj.supabase.co/functions/v1/check-pipeline-health',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key()
      ),
      body := '{}'::jsonb
    );
  $$
);
