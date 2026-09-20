-- Telegram alert bots. Each dashboard account can register its own bot
-- (made with @BotFather), connect it to a chat, and write rules that fire
-- when a settled bet matches. The collector evaluates rules as bets are
-- written and sends through the account's bot, so nothing here is shared
-- between users and the operator never messages anyone from a bot of their
-- own.
--
-- token_enc is the bot token encrypted with AES-256-GCM under ALERTS_SECRET
-- (falls back to SESSION_SECRET, then a key derived from DATABASE_URL), see
-- packages/db/src/secrets.ts. The web app and the collector share the key.

CREATE TABLE IF NOT EXISTS alert_bots (
  steam_id     text PRIMARY KEY,
  token_enc    text NOT NULL,
  bot_id       text,
  bot_username text,
  chat_id      text,
  chat_title   text,
  connected_at timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One rule = one condition on a settled bet.
--   big_bet     any bet with wagered_usd >= min_wagered (site / game optional)
--   player_bet  a bet by one account (site + player_id), optionally >= min_wagered
--   big_win     any bet whose net win (payout - wagered) >= min_net_win (site / game optional)
CREATE TABLE IF NOT EXISTS alert_rules (
  id               bigserial PRIMARY KEY,
  steam_id         text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('big_bet', 'player_bet', 'big_win')),
  site             text,
  game             text,
  player_id        text,
  min_wagered      numeric(14,4),
  min_net_win      numeric(14,4),
  cooldown_seconds integer NOT NULL DEFAULT 0,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_fired_at    timestamptz,
  fired_count      integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS alert_rules_owner_idx ON alert_rules (steam_id);

-- One row per (rule, bet) sent, so a bet re-flushed by the collector never fires twice. Pruned after a week.
CREATE TABLE IF NOT EXISTS alert_deliveries (
  rule_id bigint NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  key     text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, key)
);
CREATE INDEX IF NOT EXISTS alert_deliveries_sent_idx ON alert_deliveries (sent_at);
