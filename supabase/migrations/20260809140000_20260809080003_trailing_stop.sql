/*
# Trailing stop-loss support

1. Changes
- `strategies.trailing_stop_pct` (numeric, nullable) — when set, the strategy's
  open positions have their stop-loss ratcheted in the trade's favor as price
  moves, instead of staying fixed at the level set when the trade opened.
  NULL/0 means trailing is off (existing behavior, unchanged).
- `trades.high_water_mark` (numeric, nullable) — the best price seen since
  entry (highest for a long, lowest for a short). Needed to compute the
  trailing stop without re-scanning full price history on every check.

2. Notes
- Trailing only ever tightens the stop toward the current price, never loosens
  it — so a trade's downside is never worse than the original stop-loss.
*/

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS trailing_stop_pct numeric(5,2);

ALTER TABLE trades ADD COLUMN IF NOT EXISTS high_water_mark numeric(18,6);
