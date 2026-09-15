CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sites (
  slug      text PRIMARY KEY,
  name      text NOT NULL,
  url       text NOT NULL,
  currency  text NOT NULL DEFAULT 'USD'
);

INSERT INTO sites (slug, name, url) VALUES
  ('rustypot', 'Rustypot', 'https://rustypot.com')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------- raw events
CREATE TABLE IF NOT EXISTS raw_events (
  id          bigserial,
  site        text NOT NULL,
  event       text NOT NULL,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
SELECT create_hypertable('raw_events', 'received_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS raw_events_site_event_idx ON raw_events (site, event, received_at DESC);
ALTER TABLE raw_events SET (timescaledb.compress, timescaledb.compress_segmentby = 'site,event', timescaledb.compress_orderby = 'received_at DESC');
SELECT add_compression_policy('raw_events', INTERVAL '3 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------- players
CREATE TABLE IF NOT EXISTS players (
  site         text NOT NULL,
  external_id  text NOT NULL,
  display_name text,
  avatar       text,
  is_house     boolean NOT NULL DEFAULT false,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site, external_id)
);

-- ---------------------------------------------------------------- bets (fact)
CREATE TABLE IF NOT EXISTS bets (
  site         text NOT NULL,
  game         text NOT NULL,
  external_id  text NOT NULL,
  round_id     text,
  player_id    text NOT NULL,
  is_house     boolean NOT NULL DEFAULT false,
  wagered_usd  numeric(14,4) NOT NULL,
  payout_usd   numeric(14,4) NOT NULL DEFAULT 0,
  won          boolean,
  placed_at    timestamptz NOT NULL,
  settled_at   timestamptz,
  meta         jsonb
);
SELECT create_hypertable('bets', 'placed_at', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS bets_uniq ON bets (site, game, external_id, placed_at);
CREATE INDEX IF NOT EXISTS bets_player_idx ON bets (site, player_id, placed_at DESC);
ALTER TABLE bets SET (timescaledb.compress, timescaledb.compress_segmentby = 'site,game', timescaledb.compress_orderby = 'placed_at DESC');
SELECT add_compression_policy('bets', INTERVAL '30 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------- coinflips
CREATE TABLE IF NOT EXISTS coinflips (
  site            text NOT NULL,
  external_id     text NOT NULL,
  created_at      timestamptz NOT NULL,
  status          text NOT NULL,
  hash            text,
  creator_id      text,
  creator_pick    integer,
  creator_total   numeric(14,4),
  opponent_id     text,
  opponent_total  numeric(14,4),
  house_involved  boolean NOT NULL DEFAULT false,
  winner_id       text,
  winning_side    integer,
  pot_usd         numeric(14,4),
  tax_usd         numeric(14,4),
  house_net_usd   numeric(14,4),
  settled_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  meta            jsonb,
  PRIMARY KEY (site, external_id)
);
CREATE INDEX IF NOT EXISTS coinflips_created_idx ON coinflips (site, created_at DESC);
CREATE INDEX IF NOT EXISTS coinflips_status_idx ON coinflips (site, status);

-- ---------------------------------------------------------------- jackpots
CREATE TABLE IF NOT EXISTS jackpots (
  site           text NOT NULL,
  external_id    text NOT NULL,
  created_at     timestamptz NOT NULL,
  status         text NOT NULL,
  hash           text,
  pot_usd        numeric(14,4),
  entries        integer,
  winner_id      text,
  winner_ticket  numeric(14,4),
  tax_usd        numeric(14,4),
  house_net_usd  numeric(14,4),
  settled_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  meta           jsonb,
  PRIMARY KEY (site, external_id)
);
CREATE INDEX IF NOT EXISTS jackpots_created_idx ON jackpots (site, created_at DESC);

CREATE TABLE IF NOT EXISTS jackpot_entries (
  site          text NOT NULL,
  jackpot_id    text NOT NULL,
  player_id     text NOT NULL,
  amount_usd    numeric(14,4) NOT NULL,
  items         jsonb,
  deposited_at  timestamptz NOT NULL,
  PRIMARY KEY (site, jackpot_id, player_id, deposited_at)
);

-- ---------------------------------------------------------------- status
CREATE TABLE IF NOT EXISTS collector_status (
  site             text PRIMARY KEY,
  connected        boolean NOT NULL DEFAULT false,
  last_event_at    timestamptz,
  last_connect_at  timestamptz,
  reconnects       integer NOT NULL DEFAULT 0,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
