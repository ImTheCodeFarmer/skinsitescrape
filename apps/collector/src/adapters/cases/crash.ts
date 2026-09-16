/**
 * Crash lives on its own socket (wss://cgs.cases.gg/), no subscription
 * needed. `status` arrives on every state change (betting → in-progress →
 * ended) with the full bet list, `bet` for each bet as it is placed, `tick`
 * about seven times a second with any cashouts since the last one, and
 * `historyEntry` once a round has crashed. Bets are settled on the `ended`
 * status: a cashed-out bet pays the `winnings` the tick reported (or
 * amount × cashedOutAt if we missed the tick), everything else loses.
 *
 * Because `status` always carries every bet of the round, a round we join
 * mid-flight settles correctly too.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, seen, usd } from "./site.js";
import type { CgCrashBet, CgCrashCashout, CgCrashHistoryEntry, CgCrashStatus, CgCrashTick } from "./types.js";

type Game = { id: number; startedAt: Date; bets: Map<number, CgCrashBet>; cashouts: Map<number, CgCrashCashout>; settled: boolean };

let game: Game | null = null;

function current(id: number, startedAt: number | undefined, receivedAt: Date): Game {
  if (game?.id !== id) game = { id, startedAt: startedAt ? new Date(startedAt) : receivedAt, bets: new Map(), cashouts: new Map(), settled: false };
  return game;
}

export function handleCrashStatus(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const s = payload as CgCrashStatus;
  if (!s?.gameId) return;
  const g = current(s.gameId, s.startedAt, receivedAt);
  if (s.state === "betting" && s.startedAt) g.startedAt = new Date(s.startedAt);
  for (const b of s.bets ?? []) if (b?.betId) g.bets.set(b.betId, b);
  if (s.state === "ended") settle(g, typeof s.at === "number" ? s.at : null, receivedAt, ctx);
}

export function handleCrashBet(payload: unknown) {
  const b = payload as CgCrashBet;
  if (!game || game.settled || !b?.betId) return;
  game.bets.set(b.betId, b);
}

export function handleCrashTick(payload: unknown) {
  const t = payload as CgCrashTick;
  if (!game || !Array.isArray(t?.cashouts)) return;
  for (const c of t.cashouts) if (c?.betId) game.cashouts.set(c.betId, c);
}

/** Fallback settlement if the `ended` status was lost. */
export function handleCrashHistory(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const h = payload as CgCrashHistoryEntry;
  if (game && game.id === h?.id && !game.settled) settle(game, h.crashedAt, receivedAt, ctx);
}

function settle(g: Game, crashedAt: number | null, receivedAt: Date, ctx: AdapterContext) {
  if (g.settled) return;
  g.settled = true;
  const roundId = String(g.id);
  for (const b of g.bets.values()) {
    if (b.currency !== "REAL" || !b.user?.id) continue;
    const pid = seen(b.user, receivedAt, ctx);
    const c = g.cashouts.get(b.betId);
    const at = c?.at ?? (b.state === "cashout" ? b.cashedOutAt : undefined);
    const payout = c ? Math.round(c.winnings) : at ? Math.round(b.amount * at) : 0;
    ctx.sink.bet({
      site: SITE,
      game: "crash",
      externalId: `${roundId}:${b.betId}`,
      roundId,
      playerId: pid,
      wageredUsd: usd(b.amount),
      payoutUsd: usd(payout),
      won: payout > 0,
      placedAt: g.startedAt,
      settledAt: receivedAt,
      meta: { betId: b.betId, cashedOutAt: at ?? null, crashedAt, products: c?.productsWon ?? null },
    });
  }
}
