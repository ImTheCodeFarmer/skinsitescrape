/**
 * Case battles, room "casebattles". `newCaseBattle` comes twice: on creation
 * (no seats) and when the battle starts (seats filled, bots as "bot"). Then a
 * `battles:round` per case with one drop per seat and the battle's running
 * `unboxed_amount`, and `battles:finished` with the winner.
 *
 * Every real seat pays `total_value`, less `borrow_percent` of it when the
 * creator turned borrow mode on (the site fronts that part; the same reading
 * the Rustyloot backfill uses). Team modes (2v2, 3v3) put seats 1..n/2 on
 * team 1. The winning seats split the final unboxed amount equally; shared
 * mode splits it over everyone, cursed and jackpot modes just change who
 * `winner` names. Nothing on the feed says whether a borrowed seat's
 * winnings are docked, so the full share is recorded and `borrowPercent`
 * kept in meta.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, parse, seen, seenBot, usd } from "./site.js";
import type { ReBattle, ReBattleFinished, ReBattleRound, ReSeat } from "./types.js";

const SEATS: Record<number, { seats: number; teamSize: number; name: string }> = {
  1: { seats: 2, teamSize: 1, name: "1v1" },
  2: { seats: 3, teamSize: 1, name: "1v1v1" },
  3: { seats: 4, teamSize: 1, name: "1v1v1v1" },
  4: { seats: 4, teamSize: 2, name: "2v2" },
  5: { seats: 6, teamSize: 3, name: "3v3" },
  6: { seats: 6, teamSize: 1, name: "1v1v1v1v1v1" },
};

type Seat = { position: number; id: string; bot: boolean };
type Live = { createdAt: Date; battle: ReBattle; seats: Seat[]; pot: number; rounds: number; dropCents: number };

const live = new Map<string, Live>();
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function sweep(now: Date) {
  for (const [k, b] of live) if (now.getTime() - b.createdAt.getTime() > MAX_AGE_MS) live.delete(k);
}

const flag = (v: number | boolean | undefined) => v === true || Number(v) === 1;

function seats(b: ReBattle, at: Date, ctx: AdapterContext): Seat[] {
  const logos = parse<string[]>(b.logo) ?? [];
  const out: Seat[] = [];
  const creator = seen(b.creator, at, ctx);
  if (creator) out.push({ position: 1, id: creator, bot: false });
  const slots: (ReSeat | undefined)[] = [b.player2, b.player3, b.player4, b.player5, b.player6];
  slots.forEach((s, i) => {
    const position = i + 2;
    if (s === "bot") {
      const name = (logos[i] ?? `Bot ${position}`).replace(/\.webp$/, "");
      out.push({ position, id: seenBot(`bot-${position}`, name, at, ctx), bot: true });
    } else if (s && typeof s === "object") {
      const id = seen(s, at, ctx);
      if (id) out.push({ position, id, bot: false });
    }
  });
  return out;
}

export function handleBattleNew(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const b = (payload as { caseBattle?: ReBattle })?.caseBattle;
  if (!b?.url_key) return;
  sweep(receivedAt);
  const cur = live.get(b.url_key) ?? { createdAt: b.created_at ? new Date(b.created_at) : receivedAt, battle: b, seats: [], pot: 0, rounds: 0, dropCents: 0 };
  cur.battle = b;
  const s = seats(b, receivedAt, ctx);
  if (s.length > cur.seats.length) cur.seats = s;
  live.set(b.url_key, cur);
}

export function handleBattleRound(payload: unknown) {
  const r = payload as ReBattleRound;
  const b = r?.battleId ? live.get(String(r.battleId)) : undefined;
  if (!b || !Array.isArray(r.drops)) return;
  b.rounds += 1;
  for (const d of r.drops) b.dropCents += Math.round((Number(d?.price) || 0) * 100);
  if (typeof r.unboxed_amount === "number") b.pot = r.unboxed_amount;
  else b.pot = b.dropCents / 100;
}

/** Which seats won: "teamN" → that half of the seats; anything else names one seat. */
function winners(b: Live, winner: ReBattleFinished["winner"]): Set<number> {
  const layout = SEATS[Number(b.battle.mode)] ?? { seats: b.seats.length, teamSize: 1, name: String(b.battle.mode) };
  const all = b.seats.map((s) => s.position);
  if (flag(b.battle.shared)) return new Set(all);
  const w = String(winner ?? "").toLowerCase();
  const n = Number(w.replace(/\D+/g, ""));
  if (!n) return new Set();
  if (w.startsWith("team") && layout.teamSize > 1) {
    return new Set(all.filter((p) => Math.ceil(p / layout.teamSize) === n));
  }
  return new Set([n]);
}

export function handleBattleFinished(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const f = payload as ReBattleFinished;
  const b = f?.battleId ? live.get(String(f.battleId)) : undefined;
  if (!b) return;
  live.delete(String(f.battleId));
  const cases = Number(b.battle.case_count) || 0;
  if (!b.seats.length || b.rounds < cases) {
    ctx.log.debug({ battleId: f.battleId, rounds: b.rounds, cases, seats: b.seats.length }, "battle finished with rounds or seats missing, skipped");
    return;
  }
  const layout = SEATS[Number(b.battle.mode)];
  const won = winners(b, f.winner);
  const share = won.size ? b.pot / won.size : 0;
  const borrow = flag(b.battle.borrow) ? Math.min(100, Math.max(0, Number(b.battle.borrow_percent) || 0)) : 0;
  const price = Number(b.battle.total_value) || 0;
  const roundId = String(f.battleId);
  for (const s of b.seats) {
    const isWinner = won.has(s.position);
    const stake = s.bot ? price : price * (1 - borrow / 100);
    const payout = isWinner ? share : 0;
    ctx.sink.bet({
      site: SITE,
      game: "battles",
      externalId: `${roundId}:${s.position}`,
      roundId,
      playerId: s.id,
      isHouse: s.bot,
      wageredUsd: usd(stake),
      payoutUsd: usd(payout),
      won: payout > stake,
      placedAt: b.createdAt,
      settledAt: receivedAt,
      meta: {
        position: s.position,
        mode: layout?.name ?? b.battle.mode,
        cursed: flag(b.battle.cursed),
        shared: flag(b.battle.shared),
        jackpot: flag(b.battle.jackpot),
        terminal: flag(b.battle.terminal),
        wildcard: flag(b.battle.wildcard),
        seatUsd: price,
        borrowPercent: borrow,
        fundingPercent: flag(b.battle.funding) ? Number(b.battle.percent) || 0 : 0,
        potUsd: usd(b.pot),
        cases,
        winner: f.winner ?? null,
        onWinningTeam: isWinner,
        battleNo: b.battle.id ?? null,
      },
    });
  }
}
