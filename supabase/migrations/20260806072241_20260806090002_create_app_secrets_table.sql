/*
# Create app_secrets table for storing third-party API keys

1. New Tables
- `app_secrets`: stores key-value pairs for third-party service credentials
  - `key` (text, primary key): the secret name (e.g. BINANCE_TESTNET_API_KEY)
  - `value` (text): the secret value
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- RLS ENABLED on app_secrets.
- NO policies for anon or authenticated roles — only the service role (which bypasses RLS) can read or write.
  This prevents the frontend or any anon-key client from ever accessing stored secrets.
- The edge functions use the SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS, to read secrets at runtime.

3. Important Notes
- This table is the ONLY mechanism for storing third-party secrets in this environment, since the Supabase CLI
  and Management API are not available for setting edge function secrets directly.
- Frontend code must NEVER query this table.
*/

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- No policies: only service role can access (bypasses RLS)
-- Anon and authenticated roles get zero rows

-- Store the Binance Testnet credentials
INSERT INTO app_secrets (key, value) VALUES
  ('BINANCE_TESTNET_API_KEY', 'fVI01enmTABIYSokk6gLTrBqQLKnQaSDF4ipF46FiM849tCPJUW59edpImmudK6h'),
  ('BINANCE_TESTNET_SECRET_KEY', 'u4YDqynqYdcVFRDVOrnJJHoaB0i6H8l1cpEZv3dFLUq19f0n397di52FolrqSBEk')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
