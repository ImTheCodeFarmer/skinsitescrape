-- Rule-out by Steam id. On sites that key players by Steam id (Rustypot,
-- RustEasy, Bandit.camp), two accounts with different ids are two different
-- Steam accounts, so a shared name or picture must not link them. The job
-- now drops such pairs before scoring. Permanent links are untouched: a
-- confirmed pair between two Steam-keyed sites was a Steam match by
-- definition.

CREATE OR REPLACE PROCEDURE refresh_player_links(job_id int, config jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  DROP TABLE IF EXISTS _pl_next; -- a second call in the same transaction (a manual CALL after the job) must not trip over the last run's table
  CREATE TEMP TABLE _pl_next ON COMMIT DROP AS
  WITH p AS (
    SELECT site, external_id, display_name, avatar,
           CASE WHEN external_id ~ '^7656119[0-9]{10}$' THEN external_id END AS steam_id,
           steam_avatar_hash(avatar) AS ahash,
           CASE WHEN length(norm_name(display_name)) >= 5 AND norm_name(display_name) NOT IN ('anonymous', 'hidden', 'unknown') THEN norm_name(display_name) END AS nname
    FROM players WHERE NOT is_house
  ),
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
      -- Two Steam-keyed accounts with different Steam ids are different Steam accounts, whatever the name or picture says.
      AND NOT (a.steam_id IS NOT NULL AND b.steam_id IS NOT NULL AND a.steam_id <> b.steam_id)
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

  -- A pair scored as the same person becomes permanent, keyed by user ids only. First confirmation wins.
  INSERT INTO player_links_confirmed (site_a, player_a, site_b, player_b, score, evidence, source, confirmed_at)
  SELECT site_a, player_a, site_b, player_b, score, evidence, 'auto', now() FROM _pl_next WHERE score >= 0.95
  ON CONFLICT (site_a, player_a, site_b, player_b) DO NOTHING;

  DELETE FROM player_links;
  INSERT INTO player_links (site_a, player_a, site_b, player_b, score, evidence, computed_at)
  SELECT site_a, player_a, site_b, player_b, score, evidence, now() FROM _pl_next;

  -- Merge the permanent links back: they keep at least their confirmed score whatever the sites show today.
  INSERT INTO player_links (site_a, player_a, site_b, player_b, score, evidence, computed_at)
  SELECT c.site_a, c.player_a, c.site_b, c.player_b, c.score,
         c.evidence || jsonb_build_object('permanent', true, 'confirmedAt', c.confirmed_at, 'source', c.source), now()
  FROM player_links_confirmed c
  ON CONFLICT (site_a, player_a, site_b, player_b) DO UPDATE SET
    score = GREATEST(player_links.score, EXCLUDED.score),
    evidence = player_links.evidence || (EXCLUDED.evidence - 'steam' - 'avatar' - 'avatarOwners' - 'name' - 'sharedDays' - 'daysA' - 'daysB');
END
$$;
