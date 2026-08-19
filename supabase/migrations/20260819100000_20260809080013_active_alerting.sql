/*
# Active alerting for stale/failing pipeline jobs

1. Changes
- `notifications.type` check constraint extended with 'system_alert' so the
  health-check job can raise a real notification, not just update the
  dashboard panel.
- New table `alert_state` — one row per job_name, tracking whether we're
  currently "in alarm" for it and when we last notified. This is what stops
  the health check (running every few minutes) from spamming a fresh
  notification on every single run while a job stays down; it only fires
  again once the situation changes (recovers, or a cooldown passes).

2. Why
- Dashboard-only visibility means a stuck job is silent until someone happens
  to open the app. This makes failures actively surface as notifications
  (visible via the existing NotificationBell) instead.

3. Security
- RLS enabled on alert_state; only service role (edge functions) reads/writes
  it — it's operational state, not user data.
*/

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('trade_opened', 'trade_closed_win', 'trade_closed_loss', 'risk_limit_hit', 'broker_error', 'system_alert'));

CREATE TABLE IF NOT EXISTS alert_state (
  job_name text PRIMARY KEY,
  is_alarmed boolean NOT NULL DEFAULT false,
  last_notified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_only_alert_state" ON alert_state;
CREATE POLICY "service_only_alert_state" ON alert_state
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
