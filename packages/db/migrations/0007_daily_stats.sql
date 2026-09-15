-- Daily statistics for the game tables, so a 30- or 90-day page reads a
-- few hundred materialized rows instead of scanning every round.
--
-- 1. coinflips and jackpots become hypertables (continuous aggregates need
--    one). A hypertable's unique key must include the time column, so the
--    key becomes (site, external_id, created_at) and created_at must be a
--    pure function of the round id for upserts to keep merging. Rustypot
--    ids are Mongo ObjectIds, whose first 8 hex chars are the creation
--    time; created_at is rewritten to that and the writers derive it the
--    same way from now on.
-- 2. winner_house is stored on both tables so aggregates can tell the
--    house bot's wins from its losses without joining players.
-- 3. flips_daily, jackpots_daily and bets_daily_records materialize the
--    sums and per-day maxima the dashboard's breakdown and records need.
-- 4. Longest win streaks cannot be expressed as a per-day aggregate, so a
--    TimescaleDB job recomputes them hourly into `streaks`.
--
-- After deploying, run `pnpm --filter collector backfill --refresh-caggs`
-- once to materialize history; the policies only cover recent days.

CREATE OR REPLACE FUNCTION objectid_time(id text) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN id ~ '^[0-9a-f]{24}$' THEN to_timestamp(('x' || substr(id, 1, 8))::bit(32)::int) END
$$;

-- ---------------------------------------------------------------- coinflips
ALTER TABLE coinflips ADD COLUMN IF NOT EXISTS winner_house boolean NOT NULL DEFAULT false;
UPDATE coinflips c SET winner_house = true
  FROM players p WHERE p.site = c.site AND p.external_id = c.winner_id AND p.is_house AND NOT c.winner_house;
UPDATE coinflips SET created_at = objectid_time(external_id)
  WHERE objectid_time(external_id) IS NOT NULL AND created_at <> objectid_time(external_id);

ALTER TABLE coinflips DROP CONSTRAINT IF EXISTS coinflips_pkey;
ALTER TABLE coinflips ADD PRIMARY KEY (site, external_id, created_at);
SELECT create_hypertable('coinflips', 'created_at', chunk_time_interval => INTERVAL '7 days', migrate_data => TRUE, if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS coinflips_external_idx ON coinflips (site, external_id);
ALTER TABLE coinflips SET (timescaledb.compress, timescaledb.compress_segmentby = 'site', timescaledb.compress_orderby = 'created_at DESC');
SELECT add_compression_policy('coinflips', INTERVAL '120 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------- jackpots
ALTER TABLE jackpots ADD COLUMN IF NOT EXISTS winner_house boolean NOT NULL DEFAULT false;
UPDATE jackpots j SET winner_house = true
  FROM players p WHERE p.site = j.site AND p.external_id = j.winner_id AND p.is_house AND NOT j.winner_house;
UPDATE jackpots SET created_at = objectid_time(external_id)
  WHERE objectid_time(external_id) IS NOT NULL AND created_at <> objectid_time(external_id);

ALTER TABLE jackpots DROP CONSTRAINT IF EXISTS jackpots_pkey;
ALTER TABLE jackpots ADD PRIMARY KEY (site, external_id, created_at);
SELECT create_hypertable('jackpots', 'created_at', chunk_time_interval => INTERVAL '7 days', migrate_data => TRUE, if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS jackpots_external_idx ON jackpots (site, external_id);
ALTER TABLE jackpots SET (timescaledb.compress, timescaledb.compress_segmentby = 'site', timescaledb.compress_orderby = 'created_at DESC');
SELECT add_compression_policy('jackpots', INTERVAL '120 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------- daily aggregates
-- Per site and day: rake, the house bot's wins and losses, and the maxima
-- the records card looks up. house_net_usd already nets tax and the bot's
-- stake, so bot = house_net - tax.
CREATE MATERIALIZED VIEW IF NOT EXISTS flips_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', created_at) AS bucket,
  site,
  count(*) FILTER (WHERE status = 'Ended')                                   AS flips,
  sum(pot_usd) FILTER (WHERE status = 'Ended')                               AS pot_usd,
  sum(tax_usd) FILTER (WHERE status = 'Ended')                               AS tax_usd,
  count(*) FILTER (WHERE status = 'Ended' AND house_involved)                AS house_flips,
  sum(house_net_usd - coalesce(tax_usd, 0)) FILTER (WHERE status = 'Ended' AND house_involved AND winner_house)     AS bot_wins,
  sum(house_net_usd - coalesce(tax_usd, 0)) FILTER (WHERE status = 'Ended' AND house_involved AND NOT winner_house) AS bot_losses,
  max(pot_usd) FILTER (WHERE status = 'Ended')                               AS max_pot,
  max(CASE WHEN winner_house THEN pot_usd ELSE tax_usd END) FILTER (WHERE status = 'Ended') AS max_house_gross,
  max(pot_usd) FILTER (WHERE status = 'Ended' AND house_involved AND NOT winner_house)      AS max_bot_loss,
  bool_or(coalesce((meta->>'taxEstimated')::boolean, false)) FILTER (WHERE status = 'Ended') AS estimated
FROM coinflips
GROUP BY bucket, site
WITH NO DATA;
ALTER MATERIALIZED VIEW flips_daily SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('flips_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS jackpots_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', created_at) AS bucket,
  site,
  count(*)                                                                    AS pots,
  sum(pot_usd)                                                                AS pot_usd,
  sum(tax_usd)                                                                AS tax_usd,
  max(pot_usd)                                                                AS max_pot,
  max(CASE WHEN winner_house THEN pot_usd ELSE tax_usd END)                   AS max_house_gross,
  -- Lowest winning chance on a pot worth talking about.
  min((meta->>'winnerChance')::numeric) FILTER (WHERE pot_usd >= 25 AND (meta->>'winnerChance')::numeric > 0) AS min_chance,
  bool_or(coalesce((meta->>'taxEstimated')::boolean, false))                  AS estimated
FROM jackpots
WHERE status = 'Ended'
GROUP BY bucket, site
WITH NO DATA;
ALTER MATERIALIZED VIEW jackpots_daily SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('jackpots_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- Largest single payout to a real player per site, game and day.
CREATE MATERIALIZED VIEW IF NOT EXISTS bets_daily_records
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', placed_at) AS bucket,
  site,
  game,
  max(payout_usd) AS max_payout
FROM bets
WHERE settled_at IS NOT NULL AND NOT is_house
GROUP BY bucket, site, game
WITH NO DATA;
ALTER MATERIALIZED VIEW bets_daily_records SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('bets_daily_records',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE);

-- ---------------------------------------------------------------- streaks
-- Longest run of consecutive coinflip wins by one player, per site and
-- trailing window. Recomputed by a TimescaleDB job every hour; the 24h
-- window is cheap enough that the dashboard computes it live instead.
CREATE TABLE IF NOT EXISTS streaks (
  site        text NOT NULL,
  days        integer NOT NULL,
  player_id   text,
  streak      integer NOT NULL DEFAULT 0,
  profit_usd  numeric(14,4) NOT NULL DEFAULT 0,
  started_at  timestamptz,
  ended_at    timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site, days)
);

CREATE OR REPLACE PROCEDURE refresh_streaks(job_id int, config jsonb)
LANGUAGE plpgsql AS $$
DECLARE
  s record;
  d integer;
BEGIN
  FOR s IN SELECT DISTINCT site FROM bets_daily LOOP
    FOREACH d IN ARRAY ARRAY[7, 30, 90] LOOP
      INSERT INTO streaks (site, days, player_id, streak, profit_usd, started_at, ended_at, computed_at)
      SELECT s.site, d, r.player_id, r.streak, r.profit, r.started, r.ended, now()
      FROM (
        WITH f AS (
          SELECT player_id, placed_at, won, payout_usd - wagered_usd AS profit,
                 row_number() OVER (PARTITION BY player_id ORDER BY placed_at)
               - row_number() OVER (PARTITION BY player_id, won ORDER BY placed_at) AS grp
          FROM bets
          WHERE site = s.site AND game = 'coinflip' AND NOT is_house AND settled_at IS NOT NULL
            AND placed_at >= (now()::date - (d - 1))::timestamptz)
        SELECT player_id, count(*)::int AS streak, sum(profit) AS profit, min(placed_at) AS started, max(placed_at) AS ended
        FROM f WHERE won GROUP BY player_id, grp ORDER BY streak DESC, profit DESC LIMIT 1
      ) r
      ON CONFLICT (site, days) DO UPDATE SET
        player_id = EXCLUDED.player_id, streak = EXCLUDED.streak, profit_usd = EXCLUDED.profit_usd,
        started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, computed_at = EXCLUDED.computed_at;
    END LOOP;
  END LOOP;
END
$$;

SELECT add_job('refresh_streaks', INTERVAL '1 hour', initial_start => now() + INTERVAL '2 minutes')
WHERE NOT EXISTS (SELECT 1 FROM timescaledb_information.jobs WHERE proc_name = 'refresh_streaks');
