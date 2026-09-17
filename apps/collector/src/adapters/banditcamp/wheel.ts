/**
 * Wheel of Fortune, room "wheel". `game.wheel.round` opens a round (and is
 * sent on subscribe with the bets so far), `newBet` carries one player's
 * whole, cumulative bet sheet per field, `deleteBet` withdraws a player, and
 * `roll` names the winning segment by index. A chip on field N pays N to 1:
 * the site's client shows `bet × N + bet`.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, objectIdTime, seen, usd, type BcUser } from "./site.js";

/** The wheel, clockwise from index 0 (the client's constant). */
export const SEGMENTS = [20, 1, 3, 1, 5, 1, 3, 1, 10, 1, 3, 5, 1, 5, 1, 3, 1, 10, 1, 3, 1, 5, 1, 3, 1];

type Sheet = { bets?: Record<string, number>; user?: BcUser };
type BcRound = { id?: string; open?: boolean; bets?: Record<string, Sheet>; createdAt?: number; outcome?: number | null };

let round: { id: string; createdAt: Date; sheets: Map<string, Record<string, number>> } | null = null;

export function handleWheelRound(payload: unknown, at: Date, ctx: AdapterContext) {
  const r = payload as BcRound;
  if (!r?.id) return;
  // A round already rolled (joined between roll and the next round) has nothing left to settle.
  if (r.outcome != null) {
    round = null;
    return;
  }
  round = { id: r.id, createdAt: r.createdAt ? new Date(r.createdAt) : objectIdTime(r.id, at), sheets: new Map() };
  for (const s of Object.values(r.bets ?? {})) handleWheelBet(s, at, ctx);
}

export function handleWheelBet(payload: unknown, at: Date, ctx: AdapterContext) {
  const s = payload as Sheet;
  const id = seen(s?.user, at, ctx);
  if (round && id && s.bets) round.sheets.set(id, s.bets);
}

export function handleWheelDelete(payload: unknown) {
  if (round && payload != null) round.sheets.delete(String(payload));
}

export function handleWheelRoll(payload: unknown, at: Date, ctx: AdapterContext) {
  const outcome = Number((payload as { outcome?: number })?.outcome);
  const r = round;
  round = null;
  const field = SEGMENTS[outcome];
  if (!r || field == null) return;
  for (const [id, bets] of r.sheets) {
    const stake = Object.values(bets).reduce((a, v) => a + (Number(v) || 0), 0);
    if (stake <= 0) continue;
    const hit = Number(bets[String(field)]) || 0;
    const payout = hit * field + hit;
    ctx.sink.bet({
      site: SITE,
      game: "wheel",
      externalId: `${r.id}:${id}`,
      roundId: r.id,
      playerId: id,
      wageredUsd: usd(stake),
      payoutUsd: usd(payout),
      won: payout > stake,
      placedAt: r.createdAt,
      settledAt: at,
      meta: { outcome, field, bets },
    });
  }
}
