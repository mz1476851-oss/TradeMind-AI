/*
# Profit protection: equity peak tracking + drawdown circuit breaker

1. Why
- The bot was observed making profit, then giving a meaningful chunk of it
  back through a string of small losses (repeated whipsaw entries on the
  same asset in a choppy range, e.g. BNB opening/closing many times near
  breakeven with a net negative drift). Two changes fix the two halves of
  this:
  a) A trailing "profit protection" circuit breaker: once equity has grown,
     if it later drops too far from its own peak, trading pauses instead of
     continuing to bleed. This locks in gains at the account level, not just
     per-trade.
  b) A per-asset cooldown after a trade closes, so the same asset can't be
     immediately re-entered and re-stopped-out in a tight, choppy range.

2. Changes
- `users_profile.equity_peak` (numeric) — running high-water-mark of
  virtual_capital, updated every time a trade closes.
- `users_profile.profit_protection_pct` (numeric, default 15) — if current
  equity drops more than this % below equity_peak, new trades pause for
  that user until equity recovers.
- `strategies.reentry_cooldown_minutes` (integer, default 30) — minimum time
  after a trade on a given asset closes before that same asset can be traded
  again by the same strategy.
*/

ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS equity_peak numeric(14,2);
UPDATE users_profile SET equity_peak = virtual_capital WHERE equity_peak IS NULL;

ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS profit_protection_pct numeric(5,2) NOT NULL DEFAULT 15;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS reentry_cooldown_minutes integer NOT NULL DEFAULT 30;
