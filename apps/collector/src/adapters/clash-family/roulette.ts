/**
 * Roulette ("Double"), channel "roulette" (clash.gg). `roulette:round` comes
 * on every state change: OPEN starts a round, DRAWING carries the outcome
 * 0..14. Bets arrive one at a time on `roulette:bet` with the round's
 * gameId, the player, the colour (`option`) and the amount.
 *
 * Scoring, from the site's client: 0 is GREEN (14x), 1..7 RED (2x), 8..14
 * BLACK (2x), and 4 and 11 also pay BAIT (7x) on top of their colour.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type FamilySite, seen } from "./site.js";
import type { CgRouletteBet, CgRouletteRound } from "./types.js";

const PAYOUT: Record<string, number> = { RED: 2, BLACK: 2, GREEN: 14, BAIT: 7 };

export function winningOptions(outcome: number): string[] {
  const out: string[] = [];
  if (outcome === 0) out.push("GREEN");
  else if (outcome <= 7) out.push("RED");
  else if (outcome <= 14) out.push("BLACK");
  if (outcome === 4 || outcome === 11) out.push("BAIT");
  return out;
}

type Bet = { pid: string; option: string; amount: number };
type Round = { id: number; createdAt: Date; bets: Map<string, Bet>; settled: boolean };

export function roulette(site: FamilySite) {
  let round: Round | null = null;

  const current = (id: number, createdAt: Date): Round => {
    if (round?.id !== id) round = { id, createdAt, bets: new Map(), settled: false };
    return round;
  };

  function onBet(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const b = payload as CgRouletteBet;
    if (!b?.gameId || !b.user?.id || !PAYOUT[b.option] || b.currency !== "REAL") return;
    const r = current(b.gameId, receivedAt);
    if (r.settled) return;
    const pid = seen(site, b.user, receivedAt, ctx);
    const k = `${pid}|${b.option}`;
    const cur = r.bets.get(k);
    r.bets.set(k, { pid, option: b.option, amount: (cur?.amount ?? 0) + (Number(b.amount) || 0) });
  }

  function onRound(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const s = payload as CgRouletteRound;
    if (!s?.id) return;
    const r = current(s.id, s.createdAt ? new Date(s.createdAt) : receivedAt);
    if (s.status !== "DRAWING" || typeof s.outcome !== "number" || r.settled) return;
    r.settled = true;
    const winning = winningOptions(s.outcome);
    const roundId = String(s.id);
    for (const b of r.bets.values()) {
      const won = winning.includes(b.option);
      ctx.sink.bet({
        site: site.slug,
        game: "roulette",
        externalId: `${roundId}:${b.pid}:${b.option}`,
        roundId,
        playerId: b.pid,
        wageredUsd: site.usd(b.amount),
        payoutUsd: site.usd(won ? b.amount * PAYOUT[b.option] : 0),
        won,
        placedAt: r.createdAt,
        settledAt: receivedAt,
        meta: { option: b.option, outcome: s.outcome, winning, serialId: s.serialId ?? null },
      });
    }
  }

  return { onBet, onRound };
}
