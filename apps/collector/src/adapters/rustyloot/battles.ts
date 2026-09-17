/**
 * Case battles, room `battles:connect`. `battles:new` carries the battle and
 * its creator, `battles:newPlayer` each later seat (bots as `{bot: true,
 * index}`), and `battles:results` the winning seats and `totalValue`.
 * Battles already running at connect are skipped.
 *
 * Borrow: a seat with `borrowPercent` b pays only its own part of the price
 * and keeps only that part of its share. Checked against the site's own bet
 * ticker on 2026-09-17, down to the rounding: the site floors
 * `price × (1 − b/100)` in floating point, so an 80% borrower of a 43,140
 * seat paid 8,627 (not 8,628) and received 6,840 of a 34,202.5 share; a
 * non-borrower on a winning team of three received floor(328,196 / 3).
 * Winners split `totalValue` equally, bots included; group mode lists every
 * seat as a winner and a draw lists the seats that tied.
 *
 * `fundPercent` (the creator sponsoring part of the other seats) was 0 in
 * every battle seen; it is applied the usual way, the discount off the
 * joiners' price and onto the creator's stake, as an assumption.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, seen, seenBot, usd } from "./site.js";

type RlSeat = { id?: string | number; name?: string; avatar?: string; index: number; borrowPercent?: number | null; bot?: boolean };
type RlBattle = { id: number; joinPrice?: number; mode?: string; teamSize?: number; maxPlayers?: number; fundPercent?: number; createdAt?: string; owner?: string | number; players?: RlSeat[]; cases?: { amount?: number }[]; private?: boolean; lootSpin?: boolean };
type RlResults = { id: number; winnersData?: { isDraw?: boolean; winners?: { index: number; bot?: boolean }[]; totalValue?: number } };

type Live = { battle: RlBattle; createdAt: Date; seats: Map<number, RlSeat> };
const live = new Map<number, Live>();
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function handleBattleNew(payload: unknown, at: Date) {
  const b = payload as RlBattle;
  if (b?.id == null) return;
  for (const [k, v] of live) if (at.getTime() - v.createdAt.getTime() > MAX_AGE_MS) live.delete(k);
  const seats = new Map<number, RlSeat>();
  for (const p of b.players ?? []) seats.set(Number(p.index), p);
  live.set(Number(b.id), { battle: b, createdAt: b.createdAt ? new Date(b.createdAt) : at, seats });
}

export function handleBattlePlayer(payload: unknown) {
  const j = payload as RlSeat & { battleId?: number; player?: RlSeat };
  const b = j?.battleId != null ? live.get(Number(j.battleId)) : undefined;
  const seat = j?.player ?? j;
  if (b && seat?.index != null) b.seats.set(Number(seat.index), seat);
}

export function handleBattleResults(payload: unknown, at: Date, ctx: AdapterContext) {
  const r = payload as RlResults;
  const b = r?.id != null ? live.get(Number(r.id)) : undefined;
  if (!b || !r.winnersData) return;
  live.delete(Number(r.id));
  const max = Number(b.battle.maxPlayers) || b.seats.size;
  if (b.seats.size < max) {
    ctx.log.debug({ battleId: r.id, seats: b.seats.size, max }, "battle finished with seats missing, skipped");
    return;
  }
  const price = Number(b.battle.joinPrice) || 0;
  const fund = Math.min(100, Math.max(0, Number(b.battle.fundPercent) || 0));
  const funded = price * (fund / 100);
  const winners = new Set((r.winnersData.winners ?? []).map((w) => Number(w.index)));
  const total = Number(r.winnersData.totalValue) || 0;
  const share = winners.size ? Math.floor(total / winners.size) : 0;
  const roundId = String(r.id);
  for (const s of b.seats.values()) {
    const bot = Boolean(s.bot);
    const playerId = bot ? seenBot("battles", s.index, at, ctx) : seen(s, at, ctx);
    if (!playerId) continue;
    const owner = !bot && String(s.id) === String(b.battle.owner);
    const borrow = bot ? 0 : Math.min(100, Math.max(0, Number(s.borrowPercent) || 0));
    // The site's own arithmetic, floating point floor included.
    const kept = 1 - borrow / 100;
    const seatPrice = owner ? price + funded * (max - 1) : price - funded;
    const stake = Math.floor(seatPrice * kept);
    const won = winners.has(Number(s.index));
    const payout = won ? Math.floor(share * kept) : 0;
    ctx.sink.bet({
      site: SITE,
      game: "battles",
      externalId: `${roundId}:${s.index}`,
      roundId,
      playerId,
      isHouse: bot,
      wageredUsd: usd(stake),
      payoutUsd: usd(payout),
      won: payout > stake,
      placedAt: b.createdAt,
      settledAt: at,
      meta: {
        position: s.index,
        mode: b.battle.mode ?? null,
        teamSize: b.battle.teamSize ?? null,
        seats: max,
        seatUsd: usd(price),
        borrowPercent: borrow,
        fundingPercent: fund,
        potUsd: usd(total),
        grossShareUsd: usd(won ? share : 0),
        draw: Boolean(r.winnersData.isDraw),
        private: Boolean(b.battle.private),
        onWinningTeam: won,
      },
    });
  }
}
