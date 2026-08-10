/*
# Notifications table (Notification Agent)

1. New Tables
- `notifications`
  - `id` (uuid, pk)
  - `user_id` (uuid, references auth.users)
  - `type` (text) — 'trade_opened' | 'trade_closed_win' | 'trade_closed_loss' |
    'risk_limit_hit' | 'broker_error'
  - `title` (text)
  - `message` (text)
  - `is_read` (boolean, default false)
  - `created_at` (timestamptz)

2. Security
- RLS enabled.
- Users can SELECT and UPDATE (mark-as-read) only their own notifications.
- INSERT is service-role only — notifications are only ever written by edge
  functions (generate-signals, check-open-trades), never directly by the client.
*/

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('trade_opened', 'trade_closed_win', 'trade_closed_loss', 'risk_limit_hit', 'broker_error')),
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, created_at DESC);
