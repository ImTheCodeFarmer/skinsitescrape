-- Player wins / player losses on the dashboard, and "biggest bet a player
-- lost" in the records card, need the bet aggregates split by outcome.
-- Continuous aggregates cannot gain columns, so bets_hourly, bets_daily
-- (stacked on it) and bets_daily_records are recreated with:
--   won_profit_usd   what winning players took home net of their stake
--   lost_wagered_usd stakes lost on losing bets
--   max_loss         largest stake lost by a real player (records)
-- After deploying, run `pnpm --filter collector backfill --refresh-caggs`
-- once to materialize history; the policies only cover recent days.

DROP MATERIALIZED VIEW IF EXISTS bets_daily;
DROP MATERIALIZED VIEW IF EXISTS bets_hourly;
DROP MATERIALIZED VIEW IF EXISTS bets_daily_records;

CREATE MATERIALIZED VIEW bets_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', placed_at)                                            AS bucket,
  site,
  game,
  count(*) FILTER (WHERE NOT is_house)                                        AS bets,
  count(DISTINCT player_id) FILTER (WHERE NOT is_house)                       AS players,
  sum(wagered_usd) FILTER (WHERE NOT is_house)                                AS wagered_usd,
  sum(payout_usd)  FILTER (WHERE NOT is_house)                                AS payout_usd,
  sum(wagered_usd - payout_usd) FILTER (WHERE NOT is_house)                   AS house_net_usd,
  sum(payout_usd - wagered_usd) FILTER (WHERE NOT is_house AND won)           AS won_profit_usd,
  sum(wagered_usd) FILTER (WHERE NOT is_house AND NOT coalesce(won, false))   AS lost_wagered_usd
FROM bets
WHERE settled_at IS NOT NULL
GROUP BY bucket, site, game
WITH NO DATA;
ALTER MATERIALIZED VIEW bets_hourly SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('bets_hourly',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW bets_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', bucket) AS bucket,
  site,
  game,
  sum(bets)             AS bets,
  sum(wagered_usd)      AS wagered_usd,
  sum(payout_usd)       AS payout_usd,
  sum(house_net_usd)    AS house_net_usd,
  sum(won_profit_usd)   AS won_profit_usd,
  sum(lost_wagered_usd) AS lost_wagered_usd
FROM bets_hourly
GROUP BY 1, site, game
WITH NO DATA;
ALTER MATERIALIZED VIEW bets_daily SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('bets_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW bets_daily_records
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', placed_at) AS bucket,
  site,
  game,
  max(payout_usd)                                              AS max_payout,
  max(wagered_usd) FILTER (WHERE NOT coalesce(won, false))     AS max_loss
FROM bets
WHERE settled_at IS NOT NULL AND NOT is_house
GROUP BY bucket, site, game
WITH NO DATA;
ALTER MATERIALIZED VIEW bets_daily_records SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('bets_daily_records',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);
