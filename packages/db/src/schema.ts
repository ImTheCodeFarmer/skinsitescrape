import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Mirrors migrations/*.sql. Hypertables and continuous aggregates are
 * created in SQL; this file only describes the shape for typed queries.
 */

export const sites = pgTable("sites", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  currency: text("currency").notNull().default("USD"),
});

/** Every websocket message, verbatim. The replay source of truth. */
export const rawEvents = pgTable(
  "raw_events",
  {
    id: bigserial("id", { mode: "bigint" }),
    site: text("site").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("raw_events_site_event_idx").on(t.site, t.event, t.receivedAt)],
);

export const players = pgTable(
  "players",
  {
    site: text("site").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    avatar: text("avatar"),
    isHouse: boolean("is_house").notNull().default(false),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.site, t.externalId] })],
);

/**
 * Generic per-player bet fact table (hypertable on placed_at). Every game
 * mode writes here once the outcome is known, so rollups stay uniform.
 */
export const bets = pgTable(
  "bets",
  {
    site: text("site").notNull(),
    game: text("game").notNull(), // coinflip | jackpot | crash | ...
    externalId: text("external_id").notNull(), // unique per site+game
    roundId: text("round_id"), // the coinflip / jackpot id
    playerId: text("player_id").notNull(),
    isHouse: boolean("is_house").notNull().default(false),
    wageredUsd: numeric("wagered_usd", { precision: 14, scale: 4 }).notNull(),
    payoutUsd: numeric("payout_usd", { precision: 14, scale: 4 }).notNull().default("0"),
    won: boolean("won"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    meta: jsonb("meta"),
  },
  (t) => [
    uniqueIndex("bets_uniq").on(t.site, t.game, t.externalId, t.placedAt),
    index("bets_player_idx").on(t.site, t.playerId, t.placedAt),
  ],
);

export const coinflips = pgTable(
  "coinflips",
  {
    site: text("site").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    hash: text("hash"),
    creatorId: text("creator_id"),
    creatorPick: integer("creator_pick"),
    creatorTotal: numeric("creator_total", { precision: 14, scale: 4 }),
    opponentId: text("opponent_id"),
    opponentTotal: numeric("opponent_total", { precision: 14, scale: 4 }),
    houseInvolved: boolean("house_involved").notNull().default(false),
    winnerId: text("winner_id"),
    winningSide: integer("winning_side"),
    potUsd: numeric("pot_usd", { precision: 14, scale: 4 }),
    taxUsd: numeric("tax_usd", { precision: 14, scale: 4 }),
    houseNetUsd: numeric("house_net_usd", { precision: 14, scale: 4 }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta"),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.externalId] }),
    index("coinflips_created_idx").on(t.site, t.createdAt),
    index("coinflips_status_idx").on(t.site, t.status),
  ],
);

export const jackpots = pgTable(
  "jackpots",
  {
    site: text("site").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    hash: text("hash"),
    potUsd: numeric("pot_usd", { precision: 14, scale: 4 }),
    entries: integer("entries"),
    winnerId: text("winner_id"),
    winnerTicket: numeric("winner_ticket", { precision: 14, scale: 4 }),
    taxUsd: numeric("tax_usd", { precision: 14, scale: 4 }),
    houseNetUsd: numeric("house_net_usd", { precision: 14, scale: 4 }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta"),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.externalId] }),
    index("jackpots_created_idx").on(t.site, t.createdAt),
  ],
);

export const jackpotEntries = pgTable(
  "jackpot_entries",
  {
    site: text("site").notNull(),
    jackpotId: text("jackpot_id").notNull(),
    playerId: text("player_id").notNull(),
    amountUsd: numeric("amount_usd", { precision: 14, scale: 4 }).notNull(),
    items: jsonb("items"),
    depositedAt: timestamp("deposited_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.site, t.jackpotId, t.playerId, t.depositedAt] })],
);

/** Heartbeat per site so the dashboard can flag gaps. */
export const collectorStatus = pgTable("collector_status", {
  site: text("site").primaryKey(),
  connected: boolean("connected").notNull().default(false),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  lastConnectAt: timestamp("last_connect_at", { withTimezone: true }),
  reconnects: integer("reconnects").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
