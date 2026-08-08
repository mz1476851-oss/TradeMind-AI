/*
# User broker credentials (CoinDCX & 5paisa) — secure per-user storage

1. New Tables
- `user_broker_credentials`
  - `id` (uuid, pk)
  - `user_id` (uuid, references auth.users) — each user's own keys, never shared
  - `broker` (text) — 'coindcx' or 'fivepaisa'
  - `credentials` (jsonb) — the broker's key fields (see edge function for shape)
  - `is_active` (boolean)
  - `created_at`, `updated_at`
  - unique (user_id, broker)

2. Security
- RLS ENABLED on user_broker_credentials.
- NO policies for anon or authenticated roles — zero rows are readable/writable
  directly from the frontend, by design. Only the service role (used inside the
  `manage-broker-credentials` edge function) can read or write this table.
- The frontend NEVER queries this table directly. It calls the
  `manage-broker-credentials` edge function, which verifies the caller's Supabase
  auth JWT server-side and only ever touches that same user's row.
- This migration inserts ZERO credential values. Real estate keys are written only
  at runtime, when a user submits them from the Settings page — so they never end up
  in a migration file or git history, unlike the earlier Binance testnet keys.
- IMPORTANT: if you already committed real Binance testnet keys to git in an earlier
  migration, rotate/regenerate them on the exchange — removing them from a future
  migration does not remove them from git history.
*/

CREATE TABLE IF NOT EXISTS user_broker_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker text NOT NULL CHECK (broker IN ('coindcx', 'fivepaisa')),
  credentials jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, broker)
);

ALTER TABLE user_broker_credentials ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: anon/authenticated get zero rows.
-- Only the service role (used inside edge functions) can read or write here.
