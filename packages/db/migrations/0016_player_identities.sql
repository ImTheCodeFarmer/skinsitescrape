-- Identity hints: Steam ids learned about players on sites that do not key
-- them by Steam id. Rustyloot's chat, for one, sends each speaker's site id
-- and steamid together, so watching it (without keeping any message) maps
-- Rustyloot accounts to Steam accounts. The link job treats such a mapping
-- exactly like a Steam-keyed id: a 1.0 link to the same Steam id elsewhere,
-- a rule-out against a different one, and a subject for Steam enrichment.

CREATE TABLE IF NOT EXISTS player_identities (
  site        text NOT NULL,
  external_id text NOT NULL,
  steam_id    text NOT NULL CHECK (steam_id ~ '^7656119[0-9]{10}$'),
  source      text NOT NULL,          -- chat | profile | ...
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site, external_id, steam_id)
);
CREATE INDEX IF NOT EXISTS player_identities_steam_idx ON player_identities (steam_id);

CREATE OR REPLACE PROCEDURE refresh_player_links(job_id int, config jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  DROP TABLE IF EXISTS _pl_next;
  CREATE TEMP TABLE _pl_next ON COMMIT DROP AS
  WITH ids AS (
    -- A player's Steam id: the key itself on Steam-keyed sites, otherwise what the site's chat or profile revealed (player_identities).
    SELECT pl.site, pl.external_id,
           coalesce(CASE WHEN pl.external_id ~ '^7656119[0-9]{10}$' THEN pl.external_id END,
                    (SELECT pi.steam_id FROM player_identities pi WHERE pi.site = pl.site AND pi.external_id = pl.external_id ORDER BY pi.last_seen DESC LIMIT 1)) AS steam_id
    FROM players pl WHERE NOT pl.is_house
  ),
  p AS (
    SELECT pl.site, pl.external_id, i.steam_id,
           coalesce(steam_avatar_hash(pl.avatar), sp.avatar_hash) AS ahash,
           CASE WHEN length(norm_name(pl.display_name)) >= 5 AND norm_name(pl.display_name) NOT IN ('anonymous', 'hidden', 'unknown') THEN norm_name(pl.display_name) END AS nname
    FROM players pl
    JOIN ids i ON i.site = pl.site AND i.external_id = pl.external_id
    LEFT JOIN steam_profiles sp ON sp.steam_id = i.steam_id
    WHERE NOT pl.is_house
  ),
  -- Every name an account can be matched on: what the site shows, plus past Steam aliases for Steam-keyed accounts.
  pn AS (
    SELECT site, external_id, nname, false AS alias FROM p WHERE nname IS NOT NULL
    UNION
    SELECT p.site, p.external_id, a.norm_name, true
    FROM p JOIN steam_aliases a ON a.steam_id = p.steam_id
    WHERE length(a.norm_name) >= 5 AND a.norm_name NOT IN ('anonymous', 'hidden', 'unknown')
  ),
  ahash_owners AS (SELECT ahash, count(*) AS owners FROM p WHERE ahash IS NOT NULL GROUP BY ahash),
  name_owners  AS (SELECT nname, count(DISTINCT (site, external_id)) AS owners FROM pn GROUP BY nname),
  pairs AS (
    SELECT a.site AS site_a, a.external_id AS player_a, b.site AS site_b, b.external_id AS player_b
    FROM p a JOIN p b ON a.site < b.site AND a.steam_id IS NOT NULL AND a.steam_id = b.steam_id
    UNION
    SELECT a.site, a.external_id, b.site, b.external_id
    FROM p a JOIN p b ON a.site < b.site AND a.ahash IS NOT NULL AND a.ahash = b.ahash
    UNION
    SELECT pa.site, pa.external_id, pb.site, pb.external_id
    FROM pn pa JOIN pn pb ON pa.site < pb.site AND pa.nname = pb.nname
    JOIN name_owners no ON no.nname = pa.nname AND no.owners <= 4
  ),
  cand AS (
    SELECT x.site_a, x.player_a, x.site_b, x.player_b,
           coalesce(a.steam_id IS NOT NULL AND a.steam_id = b.steam_id, false) AS steam,
           coalesce(a.ahash IS NOT NULL AND a.ahash = b.ahash AND ao.owners <= 6 AND a.ahash NOT IN ('fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb', 'b5bd56c1aa4644a474a2e4972be27ef9e82e517e'), false) AS avatar,
           coalesce(ao.owners, 0) AS avatar_owners,
           nm.matched AS name_exact,
           coalesce(nm.name_len, 0) AS name_len,
           coalesce(nm.via_alias, false) AS via_alias
    FROM pairs x
    JOIN p a ON a.site = x.site_a AND a.external_id = x.player_a
    JOIN p b ON b.site = x.site_b AND b.external_id = x.player_b
    LEFT JOIN ahash_owners ao ON ao.ahash = a.ahash
    LEFT JOIN LATERAL (
      SELECT count(*) > 0 AS matched, max(length(pa.nname)) AS name_len, bool_and(pa.alias OR pb.alias) AS via_alias
      FROM pn pa JOIN pn pb ON pa.nname = pb.nname
      JOIN name_owners no ON no.nname = pa.nname AND no.owners <= 4
      WHERE pa.site = a.site AND pa.external_id = a.external_id AND pb.site = b.site AND pb.external_id = b.external_id
    ) nm ON true
    -- Two Steam-keyed accounts with different Steam ids are different Steam accounts, whatever the name or picture says.
    WHERE NOT (a.steam_id IS NOT NULL AND b.steam_id IS NOT NULL AND a.steam_id <> b.steam_id)
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
            - (CASE WHEN via_alias THEN 0.05 ELSE 0 END)
            + (CASE WHEN shared_days >= 3 AND shared_days::numeric / GREATEST(1, LEAST(days_a, days_b)) >= 0.3 THEN 0.2 ELSE 0 END)
            - (CASE WHEN shared_days = 0 AND days_a >= 5 AND days_b >= 5 THEN 0.15 ELSE 0 END)
          ELSE 0
        END)) AS score
    FROM scored s
  )
  SELECT site_a, player_a, site_b, player_b, round(score, 3) AS score,
         jsonb_build_object('steam', steam, 'avatar', avatar, 'avatarOwners', avatar_owners, 'name', name_exact, 'alias', via_alias,
                            'sharedDays', shared_days, 'daysA', days_a, 'daysB', days_b) AS evidence
  FROM final WHERE score >= 0.3;

  INSERT INTO player_links_confirmed (site_a, player_a, site_b, player_b, score, evidence, source, confirmed_at)
  SELECT site_a, player_a, site_b, player_b, score, evidence, 'auto', now() FROM _pl_next WHERE score >= 0.95
  ON CONFLICT (site_a, player_a, site_b, player_b) DO NOTHING;

  DELETE FROM player_links;
  INSERT INTO player_links (site_a, player_a, site_b, player_b, score, evidence, computed_at)
  SELECT site_a, player_a, site_b, player_b, score, evidence, now() FROM _pl_next;

  INSERT INTO player_links (site_a, player_a, site_b, player_b, score, evidence, computed_at)
  SELECT c.site_a, c.player_a, c.site_b, c.player_b, c.score,
         c.evidence || jsonb_build_object('permanent', true, 'confirmedAt', c.confirmed_at, 'source', c.source), now()
  FROM player_links_confirmed c
  ON CONFLICT (site_a, player_a, site_b, player_b) DO UPDATE SET
    score = GREATEST(player_links.score, EXCLUDED.score),
    evidence = player_links.evidence || (EXCLUDED.evidence - 'steam' - 'avatar' - 'avatarOwners' - 'name' - 'alias' - 'sharedDays' - 'daysA' - 'daysB');
END
$$;
