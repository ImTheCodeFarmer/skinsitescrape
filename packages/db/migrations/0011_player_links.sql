-- Cross-site identity links. One row per pair of player rows on different
-- sites that look like the same person, with a confidence score and the
-- evidence behind it. Player rows are never merged: the dashboard reads the
-- links and shows the confidence, so a link can be revised or dropped when
-- the evidence changes.
--
-- Evidence, strongest first:
--   steam      both ids are the same Steam64 id (Rustypot, RustEasy).
--   avatar     both avatars are the same Steam profile picture. Sites that
--              pass the avatars.steamstatic.com URL through expose its
--              40-hex content hash, which two accounts share only when they
--              are the same Steam account or uploaded the same image. The
--              default pictures and any hash owned by many players are
--              ignored.
--   name       the display names match after normalizing (lower case,
--              letters and digits only), for names that are five or more
--              characters and rare across the data.
--   days       days both accounts were active, out of the days either was,
--              over the last 90 days (the daily rollup); co-activity backs a
--              name match up, and never overlapping despite plenty of play
--              on both sides counts against it.
--
-- Scores: steam 1.0; avatar and name 0.98; avatar alone 0.9, or 0.75 when a
-- few other players share the picture; name alone 0.35 to 0.45 by length,
-- +0.2 with co-activity, -0.15 with none. Pairs under 0.3 are not kept.
-- Recomputed from scratch by a TimescaleDB job every hour.

CREATE OR REPLACE FUNCTION steam_avatar_hash(avatar text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN avatar ~ '(steamstatic\.com|steamcommunity)' THEN substring(avatar from '/([0-9a-f]{40})(?:_full|_medium)?\.(?:jpg|png)')
  END
$$;

CREATE OR REPLACE FUNCTION norm_name(name text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT nullif(lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')), '')
$$;

CREATE INDEX IF NOT EXISTS players_avatar_hash_idx ON players (steam_avatar_hash(avatar)) WHERE steam_avatar_hash(avatar) IS NOT NULL;
CREATE INDEX IF NOT EXISTS players_norm_name_idx ON players (norm_name(display_name)) WHERE norm_name(display_name) IS NOT NULL;

CREATE TABLE IF NOT EXISTS player_links (
  site_a      text NOT NULL,
  player_a    text NOT NULL,
  site_b      text NOT NULL,
  player_b    text NOT NULL,
  score       numeric(4,3) NOT NULL,
  evidence    jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_a, player_a, site_b, player_b),
  CHECK (site_a < site_b)
);
CREATE INDEX IF NOT EXISTS player_links_b_idx ON player_links (site_b, player_b);

-- Both directions of every link, for walking from any account.
CREATE OR REPLACE VIEW player_links_both AS
  SELECT site_a AS site, player_a AS player, site_b AS other_site, player_b AS other_player, score, evidence FROM player_links
  UNION ALL
  SELECT site_b, player_b, site_a, player_a, score, evidence FROM player_links;

CREATE OR REPLACE PROCEDURE refresh_player_links(job_id int, config jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  CREATE TEMP TABLE _pl_next ON COMMIT DROP AS
  WITH p AS (
    SELECT site, external_id, display_name, avatar,
           CASE WHEN external_id ~ '^7656119[0-9]{10}$' THEN external_id END AS steam_id,
           steam_avatar_hash(avatar) AS ahash,
           CASE WHEN length(norm_name(display_name)) >= 5 AND norm_name(display_name) NOT IN ('anonymous', 'hidden', 'unknown') THEN norm_name(display_name) END AS nname
    FROM players WHERE NOT is_house
  ),
  -- Pictures and names shared by many accounts identify nobody.
  ahash_owners AS (SELECT ahash, count(*) AS owners FROM p WHERE ahash IS NOT NULL GROUP BY ahash),
  name_owners  AS (SELECT nname, count(*) AS owners FROM p WHERE nname IS NOT NULL GROUP BY nname),
  cand AS (
    SELECT a.site AS site_a, a.external_id AS player_a, b.site AS site_b, b.external_id AS player_b,
           coalesce(a.steam_id IS NOT NULL AND a.steam_id = b.steam_id, false) AS steam,
           coalesce(a.ahash IS NOT NULL AND a.ahash = b.ahash AND ao.owners <= 6 AND a.ahash NOT IN ('fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb', 'b5bd56c1aa4644a474a2e4972be27ef9e82e517e'), false) AS avatar,
           coalesce(ao.owners, 0) AS avatar_owners,
           coalesce(a.nname IS NOT NULL AND a.nname = b.nname AND no.owners <= 4, false) AS name_exact,
           length(a.nname) AS name_len
    FROM p a
    JOIN p b ON a.site < b.site
      AND ((a.steam_id IS NOT NULL AND a.steam_id = b.steam_id)
        OR (a.ahash IS NOT NULL AND a.ahash = b.ahash)
        OR (a.nname IS NOT NULL AND a.nname = b.nname))
    LEFT JOIN ahash_owners ao ON ao.ahash = a.ahash
    LEFT JOIN name_owners  no ON no.nname = a.nname
  ),
  days AS (
    SELECT site, player_id, array_agg(DISTINCT bucket::date) AS d
    FROM player_daily WHERE bucket >= now() - interval '90 days' GROUP BY site, player_id
  ),
  scored AS (
    SELECT c.*,
           coalesce(cardinality(ARRAY(SELECT unnest(da.d) INTERSECT SELECT unnest(db.d))), 0) AS shared_days,
           coalesce(cardinality(da.d), 0) AS days_a, coalesce(cardinality(db.d), 0) AS days_b
    FROM cand c
    LEFT JOIN days da ON da.site = c.site_a AND da.player_id = c.player_a
    LEFT JOIN days db ON db.site = c.site_b AND db.player_id = c.player_b
    WHERE c.steam OR c.avatar OR c.name_exact
  ),
  final AS (
    SELECT s.*,
      LEAST(1.0, GREATEST(0.0,
        CASE
          WHEN steam THEN 1.0
          WHEN avatar AND name_exact THEN 0.98
          WHEN avatar AND avatar_owners <= 2 THEN 0.9
          WHEN avatar THEN 0.75
          WHEN name_exact THEN
            (CASE WHEN name_len >= 8 THEN 0.45 WHEN name_len >= 6 THEN 0.4 ELSE 0.35 END)
            + (CASE WHEN shared_days >= 3 AND shared_days::numeric / GREATEST(1, LEAST(days_a, days_b)) >= 0.3 THEN 0.2 ELSE 0 END)
            - (CASE WHEN shared_days = 0 AND days_a >= 5 AND days_b >= 5 THEN 0.15 ELSE 0 END)
          ELSE 0
        END)) AS score
    FROM scored s
  )
  SELECT site_a, player_a, site_b, player_b, round(score, 3) AS score,
         jsonb_build_object('steam', steam, 'avatar', avatar, 'avatarOwners', avatar_owners, 'name', name_exact,
                            'sharedDays', shared_days, 'daysA', days_a, 'daysB', days_b) AS evidence
  FROM final WHERE score >= 0.3;

  DELETE FROM player_links;
  INSERT INTO player_links (site_a, player_a, site_b, player_b, score, evidence, computed_at)
  SELECT site_a, player_a, site_b, player_b, score, evidence, now() FROM _pl_next;
END
$$;

SELECT add_job('refresh_player_links', INTERVAL '1 hour', initial_start => now() + INTERVAL '3 minutes')
WHERE NOT EXISTS (SELECT 1 FROM timescaledb_information.jobs WHERE proc_name = 'refresh_player_links');
