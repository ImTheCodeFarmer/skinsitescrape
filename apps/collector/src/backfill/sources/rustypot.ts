/**
 * Legacy `events` table: Rustypot coinflips (game_id 1) and jackpots (game_id 4).
 *
 * Coinflips map 1:1 onto the live adapter's shape, with the same external ids
 * (the site's Mongo id), so an overlap with the live collector merges instead
 * of duplicating. The legacy scraper recorded the real tax, so tax is exact
 * here where the live adapter estimates it.
 *
 * Jackpots only carry the round result (pot, tax, winner name, ticket); the
 * legacy scraper never stored per-player deposits, so no bets rows can be
 * derived and jackpot volume before the live collector is absent from the
 * wager rollups.
 */
import { objectIdTime } from "@casino/db";
import { LEGACY_META, date, groupBy, moneyFor, num, round4, str } from "../config.js";
import type { Row, Source, SourceCtx } from "../types.js";

const SITE = "rustypot";
const HOUSE_ID = "JIMMY";
const isHouse = (id: string | null) => id === HOUSE_ID;
const usd = moneyFor(SITE);

type Item = { name: string; image: string | null; side: string | null };

async function itemsFor(ctx: SourceCtx, eventIds: number[]): Promise<Map<string, Item[]>> {
  if (!eventIds.length) return new Map();
  const rows = (await ctx.legacy.unsafe(
    `SELECT eci.event_id, eci.creator_or_opponent AS side, ci.name, ci.image_url AS image
     FROM event_coinflip_items eci JOIN coinflip_items ci ON ci.id = eci.coinflip_items_id
     WHERE eci.event_id = ANY($1::int[])`,
    [eventIds],
  )) as unknown as Row[];
  const out = new Map<string, Item[]>();
  for (const [k, xs] of groupBy(rows, "event_id")) out.set(k, xs.map((x) => ({ name: x.name, image: str(x.image), side: str(x.side) })));
  return out;
}

function coinflip(r: Row, items: Item[] | undefined, ctx: SourceCtx) {
  const id = str(r.game_internal_id);
  const creatorId = str(r.creator_user_id);
  const opponentId = str(r.opponent_user_id);
  if (!id || !creatorId || !opponentId) return ctx.stats.skipped++;
  // Hypertable key: created_at derives from the id, the same way the live adapter does it.
  const createdAt = objectIdTime(id) ?? date(r.game_created_at) ?? date(r.created_at)!;
  const cutoff = ctx.cutoffs.coinflip;
  if (cutoff && createdAt >= cutoff) return ctx.stats.skipped++;

  const settledAt = date(r.game_completed_at) ?? date(r.created_at)!;
  const winnerId = str(r.winner_id);
  const creatorHouse = isHouse(creatorId);
  const opponentHouse = isHouse(opponentId);
  const creatorTotal = usd(r.creator_total);
  const opponentTotal = usd(r.opponent_total);
  const pot = round4(creatorTotal + opponentTotal);
  const taxCollected = usd(r.tax_collected);

  ctx.sink.player({ site: SITE, externalId: creatorId, displayName: str(r.creator_display_name), avatar: str(r.creator_image), isHouse: creatorHouse, seenAt: createdAt });
  ctx.sink.player({ site: SITE, externalId: opponentId, displayName: str(r.opponent_display_name), avatar: str(r.opponent_image), isHouse: opponentHouse, seenAt: createdAt });

  const ended = !!winnerId;
  let tax: number | null = null;
  let houseNet: number | null = null;
  let winnerIsHouse = false;
  if (ended) {
    winnerIsHouse = (winnerId === creatorId && creatorHouse) || (winnerId === opponentId && opponentHouse);
    const loserTotal = winnerId === creatorId ? opponentTotal : creatorTotal;
    const houseStake = creatorHouse ? creatorTotal : opponentHouse ? opponentTotal : 0;
    if (winnerIsHouse) {
      tax = 0;
      houseNet = loserTotal;
    } else {
      tax = taxCollected;
      houseNet = houseStake > 0 ? round4(-(houseStake - tax)) : tax;
    }
  }

  ctx.sink.coinflip({
    site: SITE,
    externalId: id,
    createdAt,
    status: ended ? "Ended" : "Unknown",
    hash: str(r.game_hash),
    creatorId,
    creatorTotal,
    opponentId,
    opponentTotal,
    houseInvolved: creatorHouse || opponentHouse,
    winnerId,
    winnerHouse: winnerIsHouse,
    potUsd: pot,
    taxUsd: tax,
    houseNetUsd: houseNet,
    settledAt: ended ? settledAt : null,
    meta: {
      ...LEGACY_META,
      legacyId: Number(r.id),
      createDate: str(r.game_created_at),
      winnerChance: winnerId === creatorId ? str(r.creator_chance) : str(r.joiner_chance),
      serverSeed: str(r.game_server_seed),
      ticket: str(r.game_ticket),
      isDoubleDown: !!r.is_double_down,
      taxExempt: !!r.is_double_down_tax_exempt,
      taxCollected,
      taxEstimated: false,
      items: items ?? [],
    },
  });

  if (!ended) return ctx.stats.emitted++;
  for (const [sideId, house, total] of [
    [creatorId, creatorHouse, creatorTotal],
    [opponentId, opponentHouse, opponentTotal],
  ] as const) {
    const won = sideId === winnerId;
    ctx.sink.bet({
      site: SITE,
      game: "coinflip",
      externalId: `${id}:${sideId}`,
      roundId: id,
      playerId: sideId,
      isHouse: house,
      wageredUsd: total,
      payoutUsd: won ? round4(pot - (house ? 0 : (tax ?? 0))) : 0,
      won,
      placedAt: createdAt,
      settledAt,
      meta: LEGACY_META,
    });
  }
  ctx.stats.emitted++;
}

function jackpot(r: Row, ctx: SourceCtx) {
  const id = str(r.game_internal_id);
  if (!id) return ctx.stats.skipped++;
  const createdAt = objectIdTime(id) ?? date(r.game_created_at) ?? date(r.created_at)!;
  const cutoff = ctx.cutoffs.jackpot;
  if (cutoff && createdAt >= cutoff) return ctx.stats.skipped++;
  const tax = usd(r.tax_collected);
  ctx.sink.jackpot({
    site: SITE,
    externalId: id,
    createdAt,
    status: "Ended",
    potUsd: usd(r.pot_total),
    taxUsd: tax,
    // No deposit list survives, so the house is assumed not to have played; net is the rake.
    houseNetUsd: tax,
    winnerTicket: num(r.game_ticket) || null,
    settledAt: date(r.game_completed_at) ?? createdAt,
    meta: {
      ...LEGACY_META,
      legacyId: Number(r.id),
      winnerName: str(r.winner_user_name),
      winnerImage: str(r.winner_image),
      winnerChance: num(r.jp_winner_chance),
      taxEstimated: false,
      partial: true, // deposits unknown; excluded from per-player stats like a mid-round join
    },
  });
  ctx.stats.emitted++;
}

export const rustypot: Source = {
  name: "rustypot",
  site: SITE,
  table: "events",
  where: "site_id = 1",
  cutoffs: {
    coinflip: { table: "coinflips", col: "created_at" },
    jackpot: { table: "jackpots", col: "created_at" },
  },
  async handle(rows, ctx) {
    const flips = rows.filter((r) => String(r.game_id) === "1");
    const items = await itemsFor(ctx, flips.map((r) => Number(r.id)));
    for (const r of rows) {
      const g = String(r.game_id);
      if (g === "1") coinflip(r, items.get(String(r.id)), ctx);
      else if (g === "4") jackpot(r, ctx);
      else ctx.stats.skipped++;
    }
  },
};
