ALTER TABLE users_profile
  ADD COLUMN IF NOT EXISTS starting_capital numeric(14,2) NOT NULL DEFAULT 10000.00;

-- Backfill starting_capital from virtual_capital for existing rows
UPDATE users_profile SET starting_capital = virtual_capital WHERE starting_capital = 10000.00 AND virtual_capital != 10000.00;
