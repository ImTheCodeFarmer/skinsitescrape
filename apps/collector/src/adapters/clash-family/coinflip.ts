/**
 * Item coinflip, channel "item-coinflip" (cases.gg). Two players each put in
 * items worth about `betAmount`, the creator picks LOW or HIGH, and a bot
 * can be called in. `item-coinflip:new` and `item-coinflip:update` each
 * carry the whole game; `item-coinflip:awaiting-eos` only the proof.
 *
 * No game ran during the 2026-09-16 capture and the site's history endpoint
 * was empty, so the field names come from the client code and the settlement
 * rule is an assumption flagged in meta: the winner takes every item at its
 * listed price and nothing is deducted. Fix `settle` and reparse if a real
 * game shows otherwise.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type FamilySite, seen, seenBot } from "./site.js";
import type { CgCoinflip } from "./types.js";

export function coinflip(site: FamilySite) {
  function onGame(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const g = payload as CgCoinflip;
    if (!g?.id || !Array.isArray(g.players)) return;
    const ids = new Map<number, string>();
    for (const p of g.players) {
      const id = p.user ? seen(site, p.user, receivedAt, ctx) : p.botId != null ? seenBot(site, p.botId, receivedAt, ctx) : null;
      if (id) ids.set(p.id, id);
    }
    if (g.status !== "FINISHED" || g.winnerId == null) return;
    if (g.currency && g.currency !== "REAL") return;

    const stakes = new Map<number, number>();
    for (const it of g.items ?? []) stakes.set(it.playerId, (stakes.get(it.playerId) ?? 0) + (Number(it.price) || 0));
    const pot = [...stakes.values()].reduce((a, b) => a + b, 0);
    const roundId = String(g.id);
    const placedAt = g.createdAt ? new Date(g.createdAt) : receivedAt;
    const creatorSeat = g.players.find((x) => x.user?.id === g.createdById)?.id;
    for (const p of g.players) {
      const pid = ids.get(p.id);
      if (!pid) continue;
      const won = p.id === g.winnerId;
      const stake = stakes.get(p.id) ?? g.betAmount ?? 0;
      ctx.sink.bet({
        site: site.slug,
        game: "coinflip",
        externalId: `${roundId}:${pid}`,
        roundId,
        playerId: pid,
        isHouse: p.botId != null,
        wageredUsd: site.usd(stake),
        payoutUsd: site.usd(won ? pot : 0),
        won,
        placedAt,
        settledAt: g.updatedAt ? new Date(g.updatedAt) : receivedAt,
        meta: {
          side: p.id === creatorSeat ? g.creatorSide : g.creatorSide === "LOW" ? "HIGH" : "LOW",
          betAmountCents: g.betAmount,
          potCents: pot,
          ticket: g.ticket ?? null,
          payoutAssumed: true,
        },
      });
    }
  }
  return { onGame };
}
