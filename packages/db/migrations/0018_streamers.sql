-- Streamer-marked players. A dashboard admin can right-click any player and
-- mark them as a streamer; unlike an admin mark this changes no total, it
-- only tags the name and turns the player's profile into a streamer
-- profile with the channels and socials an admin fills in.
--
-- The flag lives on players (like is_admin) so bet lists and leaderboards
-- can tag a name with the join they already make. The profile details live
-- in their own table, keyed like players, and survive an unmark so marking
-- the player again restores them. `links` maps a platform key (twitch,
-- kick, youtube, x, tiktok, instagram, discord, website) to the URL an
-- admin entered. See apps/web/src/lib/streamers.ts.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_streamer boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS streamer_profiles (
  site        text NOT NULL,
  external_id text NOT NULL,
  name        text,
  bio         text,
  links       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site, external_id)
);
