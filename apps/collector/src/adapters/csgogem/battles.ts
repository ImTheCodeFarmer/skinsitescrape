/**
 * Case battles. The feed gives the full lobby on `battle.list` (on subscribe)
 * and `battle.onNewGame`, seats as they fill on `battle.onWager`, a
 * `battle.onGameSpin` per round whose last one carries `payouts` (cents won
 * per user), and `battle.onGameEnd`. Bets are written at game end. House
 * bots ("bot-N") are is_house rows.
 *
 * Borrow mode: a player can have the site lend `borrowModifier` percent of
 * the seat. The feed's `amount` is what they actually paid (seat × the
 * remaining share) and `payouts` is the seat's full winnings, of which the
 * player keeps only that same share; the lender keeps the rest. The bet row
 * stores the player's share as payout and the seat's gross in meta.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, isBot, seen, usd } from "./site.js";
import type { GemBattle, GemBattleEnd, GemBattleSpin, GemBattleWager, GemBattleWagerEvent } from "./types.js";

type Live = {
  createdAt: Date;
  wagers: Map<string, GemBattleWager>;
  payouts: Record<string, number> | null;
  jackpotWinner: string | null;
  info: Pick<GemBattle, "teamSize" | "userCount" | "funding" | "flags" | "amount" | "level"> & { cases: number };
};

const live = new Map<number, Live>();
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function sweep(now: Date) {
  for (const [id, b] of live) if (now.getTime() - b.createdAt.getTime() > MAX_AGE_MS) live.delete(id);
}

function upsert(b: GemBattle, receivedAt: Date, ctx: AdapterContext) {
  if (!b?.battleID) return;
  const createdAt = b.createdAt ? new Date(b.createdAt) : receivedAt;
  const cur = live.get(b.battleID) ?? { createdAt, wagers: new Map(), payouts: null, jackpotWinner: null, info: { teamSize: 0, userCount: 0, funding: 0, flags: b.flags, amount: 0, level: 0, cases: 0 } };
  cur.info = { teamSize: b.teamSize, userCount: b.userCount, funding: b.funding ?? 0, flags: b.flags, amount: b.amount, level: b.level ?? 0, cases: b.rounds?.length ?? 0 };
  for (const w of b.wagers ?? []) {
    cur.wagers.set(w.userID, w);
    seen(w.user, w.userID, receivedAt, ctx);
  }
  if (b.payouts) cur.payouts = b.payouts;
  if (b.jackpotWinner) cur.jackpotWinner = b.jackpotWinner;
  live.set(b.battleID, cur);
}

/** `battle.list`: every open or running battle, sent on subscribe. */
export function handleBattleList(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  if (!Array.isArray(payload)) return;
  for (const b of payload as GemBattle[]) upsert(b, receivedAt, ctx);
}

export function handleBattleNew(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  sweep(receivedAt);
  upsert(payload as GemBattle, receivedAt, ctx);
}

export function handleBattleWager(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const w = payload as GemBattleWagerEvent;
  const b = w?.battleID ? live.get(w.battleID) : undefined;
  if (!b || !w.userID) return;
  b.wagers.set(w.userID, w);
  seen(w.user, w.userID, receivedAt, ctx);
}

export function handleBattleSpin(payload: unknown) {
  const s = payload as GemBattleSpin;
  const b = s?.battleID ? live.get(s.battleID) : undefined;
  if (!b) return;
  if (s.payouts) b.payouts = s.payouts;
  if (s.jackpotWinner) b.jackpotWinner = s.jackpotWinner;
}

export function handleBattleCancelled(payload: unknown) {
  const id = (payload as { battleID?: number })?.battleID;
  if (id) live.delete(id);
}

/** `battle.onGameEnd`: settle every seat. Skipped when we never saw the final spin (joined too late). */
export function handleBattleEnd(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const e = payload as GemBattleEnd;
  const b = e?.battleID ? live.get(e.battleID) : undefined;
  if (!b) return;
  live.delete(e.battleID);
  if (!b.payouts) {
    ctx.log.debug({ battleID: e.battleID }, "battle ended without payouts, skipped");
    return;
  }
  const roundId = String(e.battleID);
  for (const w of b.wagers.values()) {
    const gross = b.payouts[w.userID] ?? 0;
    const borrow = Math.min(100, Math.max(0, Number(w.borrowModifier) || 0));
    const payout = Math.round(gross * (1 - borrow / 100));
    ctx.sink.bet({
      site: SITE,
      game: "battles",
      externalId: `${roundId}:${w.userID}`,
      roundId,
      playerId: w.userID,
      isHouse: isBot(w.userID),
      wageredUsd: usd(w.amount),
      payoutUsd: usd(payout),
      won: payout > 0,
      placedAt: b.createdAt,
      settledAt: receivedAt,
      meta: {
        slot: w.slot,
        borrowModifier: borrow,
        grossPayoutCents: gross,
        seatCents: b.info.amount,
        teamSize: b.info.teamSize,
        seats: b.info.userCount,
        cases: b.info.cases,
        funding: b.info.funding,
        flags: b.info.flags,
        jackpotWinner: b.jackpotWinner,
        seed: e.seed,
      },
    });
  }
}
