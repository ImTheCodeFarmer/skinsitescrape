-- CSGOGem battles in borrow mode: the player pays (100 - borrowModifier)% of
-- the seat and keeps the same share of the seat's winnings; the site keeps
-- the rest. Rows written before the adapter applied that share carry the
-- seat's gross payout. Scale them down once and record the gross in meta,
-- which is also the marker that a row has been converted.
-- After deploying, run `pnpm --filter collector backfill --refresh-caggs`.
UPDATE bets
SET payout_usd = round(payout_usd * (1 - (meta->>'borrowModifier')::numeric / 100), 4),
    meta       = meta || jsonb_build_object('grossPayoutCents', round(payout_usd / 0.6 * 100))
WHERE site = 'csgogem' AND game = 'battles'
  AND meta ? 'borrowModifier' AND NOT (meta ? 'grossPayoutCents')
  AND (meta->>'borrowModifier')::numeric > 0;
