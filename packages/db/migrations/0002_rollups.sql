-- Hourly rollup per site/game. The dashboard reads this (and the daily view
-- below), never the raw bets table. House rows are excluded from wager and
-- player counts; house net is computed from real players' wager minus payout.
CREATE MATERIALIZED VIEW IF NOT EXISTS bets_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', placed_at)                    AS bucket,
  site,
  game,
  count(*) FILTER (WHERE NOT is_house)                AS bets,
  count(DISTINCT player_id) FILTER (WHERE NOT is_house) AS players,
  sum(wagered_usd) FILTER (WHERE NOT is_house)        AS wagered_usd,
  sum(payout_usd)  FILTER (WHERE NOT is_house)        AS payout_usd,
  sum(wagered_usd - payout_usd) FILTER (WHERE NOT is_house) AS house_net_usd
FROM bets
WHERE settled_at IS NOT NULL
GROUP BY bucket, site, game
WITH NO DATA;

SELECT add_continuous_aggregate_policy('bets_hourly',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);

-- Daily view stacked on the hourly aggregate (hierarchical caggs).
CREATE MATERIALIZED VIEW IF NOT EXISTS bets_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', bucket) AS bucket,
  site,
  game,
  sum(bets)          AS bets,
  sum(wagered_usd)   AS wagered_usd,
  sum(payout_usd)    AS payout_usd,
  sum(house_net_usd) AS house_net_usd
FROM bets_hourly
GROUP BY 1, site, game
WITH NO DATA;

SELECT add_continuous_aggregate_policy('bets_daily',
  start_offset => INTERVAL '7 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);

-- Per-player daily totals for leaderboards.
CREATE MATERIALIZED VIEW IF NOT EXISTS player_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', placed_at) AS bucket,
  site,
  player_id,
  game,
  count(*)                        AS bets,
  sum(wagered_usd)                AS wagered_usd,
  sum(payout_usd)                 AS payout_usd
FROM bets
WHERE settled_at IS NOT NULL AND NOT is_house
GROUP BY 1, site, player_id, game
WITH NO DATA;

SELECT add_continuous_aggregate_policy('player_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE);
