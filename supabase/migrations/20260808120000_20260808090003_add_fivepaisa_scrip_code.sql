/*
# Add 5paisa ScripCode mapping to assets

1. Changes
- Add `assets.fivepaisa_scrip_code` (integer, nullable) — 5paisa identifies
  instruments by a numeric ScripCode, not by symbol. This column lets an asset
  be mapped to its 5paisa ScripCode so live 5paisa orders can be placed for it.
  Assets without a mapping simply cannot be traded live on 5paisa (they still
  work fine in paper mode).

2. Notes
- No values are seeded here — an admin fills these in per-asset as needed
  (5paisa's scrip master list is looked up per instrument).
*/

ALTER TABLE assets ADD COLUMN IF NOT EXISTS fivepaisa_scrip_code integer;
