/**
 * Roll (the site's roulette): a game every 25 seconds. `createGame` opens a
 * round, `createBet` streams every bet on the open round (there is no game
 * id on a bet: it belongs to the latest created game) and `updateGame` walks
 * the round through WAITING_FOR_EOS_BLOCK, STARTED (with `rollValue`, 0..14)
 * and FINISHED.
 *
 * A bet's `selections` is the set of numbers it covers and it pays
 * 14 / |selections| when the roll lands in it: 0 alone (green) 14x, 1..7
 * (red) or 8..14 (black) 2x, and [4, 11] (bait) 7x, which are the four
 * bets the client offers. Bets that arrive before the first `createGame`
 * after a connect have no round and are dropped.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { knownCurrency, seen, SITE, usd, type RollUser } from "./site.js";

type RollGame = { id: string; createdAt?: string; scheduledAt?: string; startedAt?: string | null; status?: string; rollValue?: number | null };
type RollBet = { id: string; amount?: number; currency?: string; selections?: number[]; user?: RollUser };

type Live = { game: RollGame; createdAt: Date; bets: Map<string, { bet: RollBet; at: Date }> };
let current: Live | null = null;
const settled = new Set<string>();

export const rollColor = (n: number) => (n === 0 ? "green" : n <= 7 ? "red" : "black");

export function resetRoll() {
  current = null;
}

export function handleRollGameCreated(payload: unknown, at: Date) {
  const g = (payload as { createGame?: { game?: RollGame } })?.createGame?.game;
  if (!g?.id) return;
  current = { game: g, createdAt: g.createdAt ? new Date(g.createdAt) : at, bets: new Map() };
}

export function handleRollBet(payload: unknown, at: Date, ctx: AdapterContext) {
  const b = (payload as { createBet?: { bet?: RollBet } })?.createBet?.bet;
  if (!b?.id) return;
  if (!current) {
    ctx.log.debug({ betId: b.id }, "roll bet before any game, dropped");
    return;
  }
  current.bets.set(b.id, { bet: b, at });
}

export function handleRollGameUpdated(payload: unknown, at: Date, ctx: AdapterContext) {
  const g = (payload as { updateGame?: { game?: RollGame } })?.updateGame?.game;
  if (!g?.id || g.rollValue == null || !current || current.game.id !== g.id) return;
  const roundId = g.id;
  if (settled.has(roundId)) return;
  if (settled.size > 5000) settled.clear();
  settled.add(roundId);
  const roll = Number(g.rollValue);
  for (const { bet, at: placedAt } of current.bets.values()) {
    const playerId = seen(bet.user, placedAt, ctx);
    const selections = (bet.selections ?? []).map(Number);
    if (!playerId || !selections.length) continue;
    const hit = selections.includes(roll);
    const multiplier = 14 / selections.length;
    const stake = Number(bet.amount) || 0;
    ctx.sink.bet({
      site: SITE,
      game: "roulette",
      externalId: bet.id,
      roundId,
      playerId,
      wageredUsd: usd(stake, bet.currency),
      payoutUsd: usd(hit ? stake * multiplier : 0, bet.currency),
      won: hit,
      placedAt,
      settledAt: at,
      meta: {
        selections,
        roll,
        color: rollColor(roll),
        multiplier: hit ? multiplier : 0,
        currency: bet.currency ?? null,
        ...(knownCurrency(bet.currency) ? {} : { currencyUnknown: true }),
      },
    });
  }
  current = null;
}
