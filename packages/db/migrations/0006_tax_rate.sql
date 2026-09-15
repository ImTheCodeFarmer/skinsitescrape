-- The live collector estimated tax at 10% of the loser's side (flips) and
-- 10% of the pot (jackpots). The legacy scraper's recorded tax shows the
-- site takes 5% of the pot in both games. Recompute the estimated rows;
-- rows imported from legacy carry the real figure and are untouched.
-- Idempotent: a row already at 5% is not selected.

-- Coinflips a real player won (tax > 0): tax, house net, and the winner's payout move by the same delta.
WITH todo AS (
  SELECT site, external_id, created_at, round(pot_usd * 0.05, 4) - tax_usd AS delta
  FROM coinflips
  WHERE (meta->>'taxEstimated')::boolean AND tax_usd > 0 AND pot_usd IS NOT NULL AND tax_usd <> round(pot_usd * 0.05, 4)
), flips AS (
  UPDATE coinflips c SET tax_usd = c.tax_usd + t.delta, house_net_usd = c.house_net_usd + t.delta
  FROM todo t WHERE c.site = t.site AND c.external_id = t.external_id
)
UPDATE bets b SET payout_usd = b.payout_usd - t.delta
FROM todo t
WHERE b.site = t.site AND b.game = 'coinflip' AND b.round_id = t.external_id AND b.won
  AND b.placed_at >= t.created_at - interval '1 day' AND b.placed_at <= t.created_at + interval '1 day';

-- Jackpots a real player won (tax > 0): same treatment; the paid entry is the one with a payout.
WITH todo AS (
  SELECT site, external_id, created_at, round(pot_usd * 0.05, 4) - tax_usd AS delta
  FROM jackpots
  WHERE (meta->>'taxEstimated')::boolean AND tax_usd > 0 AND pot_usd IS NOT NULL AND tax_usd <> round(pot_usd * 0.05, 4)
), pots AS (
  UPDATE jackpots j SET tax_usd = j.tax_usd + t.delta, house_net_usd = j.house_net_usd + t.delta
  FROM todo t WHERE j.site = t.site AND j.external_id = t.external_id
)
UPDATE bets b SET payout_usd = b.payout_usd - t.delta
FROM todo t
WHERE b.site = t.site AND b.game = 'jackpot' AND b.round_id = t.external_id AND b.payout_usd > 0
  AND b.placed_at >= t.created_at - interval '1 day' AND b.placed_at <= t.created_at + interval '1 day';
