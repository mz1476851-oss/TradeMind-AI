/*
# Speed: fetch market data every 1 minute instead of every 2

Bulk API calls per category (one CoinGecko call for all crypto, one Twelve
Data call for all stocks, one exchangerate.host call for all forex) mean
this is still just 3 external calls/minute -- comfortably within free-tier
rate limits, but doubles how often the app sees a fresh price.
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_fetch_market_data';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;
END $$;

SELECT cron.schedule(
  'trademind_fetch_market_data',
  '* * * * *',
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
