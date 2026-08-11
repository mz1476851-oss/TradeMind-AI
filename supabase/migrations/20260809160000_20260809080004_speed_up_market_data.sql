/*
# Speed up market data collection: every 10 min -> every 2 min

1. Why
- Faster, more granular price history means the indicators (ATR, RSI, EMA,
  etc.) have real, meaningful data to work with sooner, and volatility reads
  are less likely to look artificially flat.
- This does NOT need any manual PowerShell loop ever again — pg_cron runs
  this in the background automatically, forever, with no action needed.

2. Changes
- Re-points the `trademind_fetch_market_data` cron job from '*/10 * * * *'
  (every 10 min) to '*/2 * * * *' (every 2 min).
- Signal generation and position monitoring stay on their existing schedules
  (10 min / 5 min) — there's no benefit to re-scoring signals faster than
  that, only to collecting more price history faster.

3. Notes
- Free-tier price APIs (CoinGecko, exchangerate.host, Twelve Data) have rate
  limits that make "every second" impractical and unnecessary for a
  short/long-term signal system — this is not a high-frequency trading bot.
  Every 2 minutes is a reasonable, sustainable pace.
*/

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'trademind_fetch_market_data';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'trademind_fetch_market_data',
  '*/2 * * * *',
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
