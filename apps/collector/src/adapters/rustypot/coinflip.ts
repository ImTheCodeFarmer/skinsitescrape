import type { AdapterContext } from "../../core/adapter.js";
import type { RpCoinflip, RpSide, RpItem } from "./types.js";

export const SITE = "rustypot";
export const HOUSE_ID = "JIMMY";
/**
 * Rake on a flip a real player wins: 5% of the whole pot. Not in the feed;
 * measured on 51k flips from the legacy scraper's recorded tax (5.00% ± 0.06).
 */
export const COINFLIP_TAX_RATE = 0.05;

export const isHouseSide = (side?: Partial<RpSide> | null) =>
  !!side && (side.id === HOUSE_ID || side.displayName === HOUSE_ID || (side.image ?? "").includes("/img/jimmy/"));

const sum = (items?: RpItem[]) => (items ?? []).reduce((a, i) => a + (Number(i.price) || 0), 0);
const sideTotal = (side?: Partial<RpSide> | null) =>
  side && side.id ? (typeof side.total === "number" ? side.total : sum(side.depositedItems)) : null;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function handleCoinflip(cf: RpCoinflip, receivedAt: Date, ctx: AdapterContext) {
  if (!cf?._id || !cf.creator?.id) return;
  const createdAt = cf.createDate ? new Date(cf.createDate) : receivedAt;
  const opponent = cf.opponent && cf.opponent.id ? cf.opponent : null;
  const creatorHouse = isHouseSide(cf.creator);
  const opponentHouse = isHouseSide(opponent);
  const creatorTotal = sideTotal(cf.creator);
  const opponentTotal = sideTotal(opponent);

  ctx.sink.player({ site: SITE, externalId: cf.creator.id, displayName: cf.creator.displayName, avatar: cf.creator.image, isHouse: creatorHouse, seenAt: receivedAt });
  if (opponent) ctx.sink.player({ site: SITE, externalId: opponent.id!, displayName: opponent.displayName, avatar: opponent.image, isHouse: opponentHouse, seenAt: receivedAt });

  const ended = cf.status === "Ended" && !!cf.winner?.id;
  const settledAt = ended ? (cf.completedDate ? new Date(cf.completedDate) : receivedAt) : null;

  let potUsd: number | null = null;
  let taxUsd: number | null = null;
  let houseNetUsd: number | null = null;

  if (ended && opponent && creatorTotal != null && opponentTotal != null) {
    const winnerId = cf.winner!.id;
    potUsd = round4(creatorTotal + opponentTotal);
    const winnerIsHouse = (winnerId === cf.creator.id && creatorHouse) || (winnerId === opponent.id && opponentHouse);
    const loserTotal = winnerId === cf.creator.id ? opponentTotal : creatorTotal;
    const houseStake = creatorHouse ? creatorTotal : opponentHouse ? opponentTotal : 0;

    if (winnerIsHouse) {
      taxUsd = 0;
      houseNetUsd = round4(loserTotal); // Jimmy keeps the player's items outright
    } else {
      taxUsd = round4(potUsd * COINFLIP_TAX_RATE); // estimate, see COINFLIP_TAX_RATE
      houseNetUsd = houseStake > 0 ? round4(-(houseStake - taxUsd)) : taxUsd; // lost Jimmy's items (net of tax) or pure rake
    }
  }

  ctx.sink.coinflip({
    site: SITE,
    externalId: cf._id,
    createdAt,
    status: cf.status ?? "unknown",
    hash: cf.hash?.hash ?? null,
    creatorId: cf.creator.id,
    creatorPick: typeof cf.creator.pick === "number" ? cf.creator.pick : null,
    creatorTotal,
    opponentId: opponent?.id ?? null,
    opponentTotal,
    houseInvolved: creatorHouse || opponentHouse,
    winnerId: cf.winner?.id ?? null,
    winningSide: typeof cf.winner?.coin === "number" ? cf.winner.coin : null,
    potUsd,
    taxUsd,
    houseNetUsd,
    settledAt,
    meta: ended
      ? {
          winnerChance: cf.winner?.chance,
          serverSeed: cf.hash?.serverSeed,
          ticket: cf.hash?.ticket,
          doubleDownCount: cf.doubleDownCount,
          taxEstimated: true,
          creatorItems: cf.creator.depositedItems,
          opponentItems: opponent?.depositedItems,
        }
      : null,
  });

  if (ended && opponent && potUsd != null && settledAt) {
    const winnerId = cf.winner!.id;
    for (const { side, house, total } of [
      { side: cf.creator, house: creatorHouse, total: creatorTotal ?? 0 },
      { side: opponent, house: opponentHouse, total: opponentTotal ?? 0 },
    ]) {
      const won = side.id === winnerId;
      ctx.sink.bet({
        site: SITE,
        game: "coinflip",
        externalId: `${cf._id}:${side.id}`,
        roundId: cf._id,
        playerId: side.id!,
        isHouse: house,
        wageredUsd: round4(total),
        payoutUsd: won ? round4(potUsd - (house ? 0 : (taxUsd ?? 0))) : 0,
        won,
        placedAt: createdAt,
        settledAt,
      });
    }
  }
}

/** "cf RemoveLobby": lobby withdrawn before a flip. Mark it so it never counts. */
export function handleCoinflipRemoved(id: unknown, receivedAt: Date, ctx: AdapterContext) {
  if (typeof id !== "string") return;
  ctx.sink.coinflip({ site: SITE, externalId: id, createdAt: receivedAt, status: "Removed" });
}
