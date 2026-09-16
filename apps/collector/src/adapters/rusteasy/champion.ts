/**
 * Champion, room "champion": a king-of-the-hill. Whoever holds the throne
 * stakes their whole stack against each challenger, who deposits the same
 * amount; a weighted ticket decides. `challengerInfo` opens a fight with both
 * sides' totals, `championEnd` closes it without saying who won, and the
 * `newChampionInfo` that follows (or `champion`, a JSON string, when the
 * throne changes hands) names the holder, which is the winner. The winner's
 * stack becomes the pot; the site's 10% fee (FAQ) is applied as an estimate
 * since the feed never states it.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { CHAMPION_FEE, SITE, isHouse, parse, seen, usd } from "./site.js";
import type { ReChallenger, ReChampionInfo, ReChampionSeat } from "./types.js";

type Fight = { startedAt: Date; champion: { id: string; amount: number }; challenger: { id: string; amount: number }; ended: boolean; no: number };
let fight: Fight | null = null;
let fights = 0;

export function handleChallenger(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const c = parse<ReChallenger>(payload);
  if (!c?.champion_steamid64 || !c.opponent_steamid64) return;
  const champion = seen({ steamid64: c.champion_steamid64, username: c.champion_username, avatar: c.champion_avatar }, receivedAt, ctx);
  const challenger = seen({ steamid64: c.opponent_steamid64, username: c.opponent_username, avatar: c.opponent_avatar }, receivedAt, ctx);
  if (!champion || !challenger) return;
  fight = { startedAt: receivedAt, champion: { id: champion, amount: usd(c.champion_total) }, challenger: { id: challenger, amount: usd(c.opponent_total) }, ended: false, no: ++fights };
}

export function handleChampionEnd() {
  if (fight) fight.ended = true;
}

/** The holder after a fight is its winner. */
export function handleChampionHolder(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const h = parse<ReChampionInfo & ReChampionSeat>(payload);
  const holder = h?.champion_steamid64 ?? h?.steamid64;
  if (!h || !holder) return;
  seen({ steamid64: holder, username: h.champion_username ?? h.username, avatar: h.champion_avatar ?? h.avatar }, receivedAt, ctx);
  const f = fight;
  if (!f) return;
  fight = null;
  const winnerId = String(holder);
  if (winnerId !== f.champion.id && winnerId !== f.challenger.id) return;
  const pot = f.champion.amount + f.challenger.amount;
  const roundId = `${f.startedAt.toISOString()}`;
  for (const p of [f.champion, f.challenger]) {
    const won = p.id === winnerId;
    ctx.sink.bet({
      site: SITE,
      game: "champion",
      externalId: `${roundId}:${p.id}`,
      roundId,
      playerId: p.id,
      isHouse: isHouse(p.id),
      wageredUsd: p.amount,
      payoutUsd: won ? usd(pot * (1 - CHAMPION_FEE)) : 0,
      won,
      placedAt: f.startedAt,
      settledAt: receivedAt,
      meta: { role: p === f.champion ? "champion" : "challenger", potUsd: usd(pot), feeRate: CHAMPION_FEE, taxEstimated: true, endedSeen: f.ended },
    });
  }
}
