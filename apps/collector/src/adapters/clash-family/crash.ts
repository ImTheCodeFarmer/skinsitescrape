/**
 * Crash lives on its own socket (cgs.cases.gg, gs.clash.gg), no subscription
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
import type { AdapterContext, SiteAdapter } from "../../core/adapter.js";
import { type FamilySite, seen } from "./site.js";
import type { CgCrashBet, CgCrashCashout, CgCrashHistoryEntry, CgCrashStatus, CgCrashTick } from "./types.js";

type Game = { id: number; startedAt: Date; bets: Map<number, CgCrashBet>; cashouts: Map<number, CgCrashCashout>; settled: boolean };

/** Raw rows from the crash socket are stored as "crash:<event>" so they can be told from the main feed's; a reparse hands them back with that prefix. */
const PREFIX = "crash:";

export function crash(site: FamilySite) {
  let game: Game | null = null;

  const current = (id: number, startedAt: number | undefined, receivedAt: Date): Game => {
    if (game?.id !== id) game = { id, startedAt: startedAt ? new Date(startedAt) : receivedAt, bets: new Map(), cashouts: new Map(), settled: false };
    return game;
  };

  function settle(g: Game, crashedAt: number | null, receivedAt: Date, ctx: AdapterContext) {
    if (g.settled) return;
    g.settled = true;
    const roundId = String(g.id);
    for (const b of g.bets.values()) {
      if (b.currency !== "REAL" || !b.user?.id) continue;
      const pid = seen(site, b.user, receivedAt, ctx);
      const c = g.cashouts.get(b.betId);
      const at = c?.at ?? (b.state === "cashout" ? b.cashedOutAt : undefined);
      const payout = c ? Math.round(c.winnings) : at ? Math.round(b.amount * at) : 0;
      ctx.sink.bet({
        site: site.slug,
        game: "crash",
        externalId: `${roundId}:${b.betId}`,
        roundId,
        playerId: pid,
        wageredUsd: site.usd(b.amount),
        payoutUsd: site.usd(payout),
        won: payout > 0,
        placedAt: g.startedAt,
        settledAt: receivedAt,
        meta: { betId: b.betId, cashedOutAt: at ?? null, crashedAt, products: c?.productsWon ?? null },
      });
    }
  }

  function onStatus(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const s = payload as CgCrashStatus;
    if (!s?.gameId) return;
    const g = current(s.gameId, s.startedAt, receivedAt);
    if (s.state === "betting" && s.startedAt) g.startedAt = new Date(s.startedAt);
    for (const b of s.bets ?? []) if (b?.betId) g.bets.set(b.betId, b);
    if (s.state === "ended") settle(g, typeof s.at === "number" ? s.at : null, receivedAt, ctx);
  }

  function onBet(payload: unknown) {
    const b = payload as CgCrashBet;
    if (!game || game.settled || !b?.betId) return;
    game.bets.set(b.betId, b);
  }

  function onTick(payload: unknown) {
    const t = payload as CgCrashTick;
    if (!game || !Array.isArray(t?.cashouts)) return;
    for (const c of t.cashouts) if (c?.betId) game.cashouts.set(c.betId, c);
  }

  /** Fallback settlement if the `ended` status was lost. */
  function onHistory(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const h = payload as CgCrashHistoryEntry;
    if (game && game.id === h?.id && !game.settled) settle(game, h.crashedAt, receivedAt, ctx);
  }

  /** The whole crash-socket adapter for a site. */
  const adapter = (url: string): SiteAdapter => ({
    site: site.slug,
    feed: "crash",
    connection: { url, protocol: "pair", pageUrl: `${site.origin}/crash` },
    handle({ event: name, args, receivedAt }, ctx) {
      const event = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
      if (!["status", "bet", "tick", "historyEntry"].includes(event)) return;
      const p = args[0];
      // Ticks are ~7/s; only the ones that carry a cashout are worth keeping.
      if (event !== "tick" || (p as CgCrashTick)?.cashouts?.length) {
        ctx.sink.rawEvent({ site: site.slug, event: PREFIX + event, payload: args.length === 1 ? p : args, receivedAt });
      }
      switch (event) {
        case "status":
          return onStatus(p, receivedAt, ctx);
        case "bet":
          return onBet(p);
        case "tick":
          return onTick(p);
        case "historyEntry":
          return onHistory(p, receivedAt, ctx);
      }
    },
  });

  return { adapter };
}
