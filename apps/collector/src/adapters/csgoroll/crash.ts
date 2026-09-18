/**
 * Crash. `createCrashGame` opens a round, `createCrashBet` carries each bet
 * (`totalBet` in the bet's currency, `maxTick` the auto cash-out, `items`
 * when skins were staked), `updateCrashBet` a cash-out (`tick`,
 * `totalWinAmount`) and `updateCrashGame` walks the round to FINISHED with
 * `roll` in hundredths (171 is 1.71x) or to a `cancelledReason`.
 *
 * Settled when the game finishes: a bet with a `totalWinAmount` is paid
 * that, every other bet loses its stake. A cash-out that arrives after the
 * finish (the site sends them around the same moment) rewrites the row,
 * which the sink upserts. Bets on a game whose creation was not seen are
 * still settled: the bets themselves arrive individually, so a round joined
 * mid-way is complete for the bets placed after connect and marked partial.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { knownCurrency, seen, SITE, usd, type RollUser } from "./site.js";

type CrashGame = { id: string; startedAt?: string | null; status?: string; roll?: number | null; cancelledReason?: string | null };
type CrashBet = { id: string; gameId?: string; currency?: string; totalBet?: number; maxTick?: number | null; tick?: number | null; totalWinAmount?: number | null; user?: RollUser; items?: { edges?: { node?: { itemVariant?: { name?: string; value?: number } } }[] } };

type Live = { created: boolean; createdAt: Date; bets: Map<string, { bet: CrashBet; at: Date }>; result?: { roll: number; at: Date } };
const games = new Map<string, Live>();
const MAX_AGE_MS = 30 * 60 * 1000;

function game(id: string, at: Date, created: boolean): Live {
  for (const [k, v] of games) if (at.getTime() - v.createdAt.getTime() > MAX_AGE_MS) games.delete(k);
  let g = games.get(id);
  if (!g) games.set(id, (g = { created, createdAt: at, bets: new Map() }));
  return g;
}

export function handleCrashGameCreated(payload: unknown, at: Date) {
  const g = (payload as { createCrashGame?: { crashGame?: CrashGame } })?.createCrashGame?.crashGame;
  if (!g?.id) return;
  game(g.id, g.startedAt ? new Date(g.startedAt) : at, true).created = true;
}

export function handleCrashBetCreated(payload: unknown, at: Date, ctx: AdapterContext) {
  const b = (payload as { createCrashBet?: { crashBet?: CrashBet } })?.createCrashBet?.crashBet;
  if (!b?.id || !b.gameId) return;
  const g = game(b.gameId, at, false);
  g.bets.set(b.id, { bet: b, at });
  if (g.result) settleBet(b.gameId, g, b.id, ctx);
}

export function handleCrashBetUpdated(payload: unknown, at: Date, ctx: AdapterContext) {
  const b = (payload as { updateCrashBet?: { crashBet?: CrashBet } })?.updateCrashBet?.crashBet;
  if (!b?.id || !b.gameId) return;
  const g = game(b.gameId, at, false);
  const prev = g.bets.get(b.id);
  g.bets.set(b.id, { bet: { ...prev?.bet, ...b }, at: prev?.at ?? at });
  if (g.result) settleBet(b.gameId, g, b.id, ctx);
}

export function handleCrashGameUpdated(payload: unknown, at: Date, ctx: AdapterContext) {
  const u = (payload as { updateCrashGame?: { crashGame?: CrashGame } })?.updateCrashGame?.crashGame;
  if (!u?.id) return;
  if (u.cancelledReason) {
    games.delete(u.id);
    return;
  }
  if (u.status !== "FINISHED" || u.roll == null) return;
  const g = games.get(u.id);
  if (!g || g.result) return;
  g.result = { roll: Number(u.roll), at };
  for (const betId of g.bets.keys()) settleBet(u.id, g, betId, ctx);
}

function settleBet(gameId: string, g: Live, betId: string, ctx: AdapterContext) {
  const entry = g.bets.get(betId);
  if (!entry || !g.result) return;
  const { bet, at: placedAt } = entry;
  const playerId = seen(bet.user, placedAt, ctx);
  if (!playerId) return;
  const stake = Number(bet.totalBet) || 0;
  const cashedOut = bet.tick != null && Number(bet.totalWinAmount) > 0;
  const payout = cashedOut ? Number(bet.totalWinAmount) : 0;
  const items = (bet.items?.edges ?? []).map((e) => e?.node?.itemVariant).filter(Boolean);
  ctx.sink.bet({
    site: SITE,
    game: "crash",
    externalId: bet.id,
    roundId: gameId,
    playerId,
    wageredUsd: usd(stake, bet.currency),
    payoutUsd: usd(payout, bet.currency),
    won: payout > stake,
    placedAt,
    settledAt: g.result.at,
    meta: {
      crashPoint: g.result.roll / 100,
      cashout: cashedOut ? Number(bet.tick) / 100 : null,
      autoCashout: bet.maxTick != null ? Number(bet.maxTick) / 100 : null,
      currency: bet.currency ?? null,
      ...(items.length ? { items: items.map((i) => ({ name: i!.name ?? null, value: i!.value ?? null })) } : {}),
      ...(g.created ? {} : { partial: true }),
      ...(knownCurrency(bet.currency) ? {} : { currencyUnknown: true }),
    },
  });
}
