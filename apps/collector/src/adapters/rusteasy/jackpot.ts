/**
 * Jackpot, room "jackpot". `newDeposit` (a JSON string) carries the whole
 * round so far: game id, pot and every deposit with its player. `slider`
 * announces the draw with per-player totals, chances and the winner, and
 * `newGame` opens the next round. The winner takes the pot less the site's
 * fee (7% per the FAQ, 5% with the promo tag; estimated, the feed never
 * says). The house bot "Tunnel Dweller" deposits too.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { JACKPOT_FEE, SITE, isHouse, parse, seen, usd } from "./site.js";
import type { ReJackpotBet, ReJackpotDeposit, ReJackpotSlider } from "./types.js";

type Round = { gameId: number; startedAt: Date; bets: Map<number, ReJackpotBet>; settled: boolean };
let round: Round | null = null;

function current(gameId: number, at: Date): Round {
  if (round?.gameId !== gameId) round = { gameId, startedAt: at, bets: new Map(), settled: false };
  return round;
}

export function handleJackpotDeposit(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const d = parse<ReJackpotDeposit>(payload);
  if (!d?.gameId || !Array.isArray(d.bets)) return;
  const r = current(d.gameId, receivedAt);
  for (const b of d.bets) {
    if (!b?.id) continue;
    seen(b.user, receivedAt, ctx);
    r.bets.set(b.id, b);
  }
}

export function handleJackpotNewGame(payload: unknown, receivedAt: Date) {
  const id = (payload as { game?: { id?: number } })?.game?.id;
  if (id) current(id, receivedAt);
}

export function handleJackpotSlider(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const s = parse<ReJackpotSlider>(payload);
  if (!s?.winner?.steamid64) return;
  const gameId = s.bets?.find((b) => b?.game_id)?.game_id ?? round?.gameId;
  if (!gameId) return;
  const r = current(gameId, receivedAt);
  if (r.settled) return;
  for (const b of s.bets ?? []) if (b?.id) r.bets.set(b.id, b);
  r.settled = true;

  const winnerId = String(s.winner.steamid64);
  seen(s.winner, receivedAt, ctx);
  const totals = new Map<string, { amount: number; deposits: number }>();
  for (const b of r.bets.values()) {
    const id = seen(b.user, receivedAt, ctx);
    if (!id) continue;
    const t = totals.get(id) ?? { amount: 0, deposits: 0 };
    t.amount += Number(b.price) || 0;
    t.deposits += 1;
    totals.set(id, t);
  }
  const pot = [...totals.values()].reduce((a, t) => a + t.amount, 0);
  const roundId = String(gameId);
  for (const [id, t] of totals) {
    const won = id === winnerId;
    ctx.sink.bet({
      site: SITE,
      game: "jackpot",
      externalId: `${roundId}:${id}`,
      roundId,
      playerId: id,
      isHouse: isHouse(id),
      wageredUsd: usd(t.amount),
      payoutUsd: won ? usd(pot * (1 - JACKPOT_FEE)) : 0,
      won,
      placedAt: r.startedAt,
      settledAt: receivedAt,
      meta: { potUsd: usd(pot), deposits: t.deposits, chance: pot > 0 ? Math.round((t.amount / pot) * 10000) / 100 : null, feeRate: JACKPOT_FEE, taxEstimated: true, winnerChance: s.winner.chance ?? null },
    });
  }
}
