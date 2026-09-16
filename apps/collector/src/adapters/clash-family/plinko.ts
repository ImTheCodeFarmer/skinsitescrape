/**
 * Plinko, channel "plinko" (clash.gg). The site shows other players' balls
 * live: `plinko:social-game` is one finished drop with the player, the bet,
 * the multiplier it landed on and the currency. There is no round id, so a
 * bet is named by the time it arrived and the player, which a reparse
 * reproduces from `received_at`.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type FamilySite, avatarUrl } from "./site.js";
import type { CgPlinkoGame } from "./types.js";

export function plinko(site: FamilySite) {
  function onGame(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const g = payload as CgPlinkoGame;
    if (!g?.userId || g.currency !== "REAL" || typeof g.multiplier !== "number") return;
    const pid = String(g.userId);
    ctx.sink.player({ site: site.slug, externalId: pid, avatar: avatarUrl(site, g.avatarUrl), seenAt: receivedAt });
    const bet = Number(g.betAmount) || 0;
    const payout = Math.round(bet * g.multiplier);
    ctx.sink.bet({
      site: site.slug,
      game: "plinko",
      externalId: `${receivedAt.toISOString()}:${pid}`,
      roundId: null,
      playerId: pid,
      wageredUsd: site.usd(bet),
      payoutUsd: site.usd(payout),
      won: payout > bet,
      placedAt: receivedAt,
      settledAt: receivedAt,
      meta: { multiplier: g.multiplier, rows: g.rows ?? null, risk: g.risk ?? null },
    });
  }
  return { onGame };
}
