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
 * `winner` names.
 *
 * A borrowed seat keeps only the share it paid for: on 2026-09-16 the
 * creator of battle CWnl4LuJ4Px7qy8I staked $297.79 of a $1,488.96 seat (80%
 * borrowed), his team's share was $5,673.63 and the site showed him
 * receiving $1,134.73, exactly 20%. The battle's own room ("battle-<key>",
 * joined per battle) also sends `caseBattleWinner` with the site's
 * `winnerPrize`; its per-seat figure is kept in meta (`siteWinningsUsd`) to
 * check against, not used, because it is not yet known whether it is gross
 * or docked for a borrower.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, parse, seen, seenBot, usd } from "./site.js";
import type { ReBattle, ReBattleFinished, ReBattleRound, ReBattleWinner, ReSeat } from "./types.js";

const SEATS: Record<number, { seats: number; teamSize: number; name: string }> = {
  1: { seats: 2, teamSize: 1, name: "1v1" },
  2: { seats: 3, teamSize: 1, name: "1v1v1" },
  3: { seats: 4, teamSize: 1, name: "1v1v1v1" },
  4: { seats: 4, teamSize: 2, name: "2v2" },
  5: { seats: 6, teamSize: 3, name: "3v3" },
  6: { seats: 6, teamSize: 1, name: "1v1v1v1v1v1" },
};

type Seat = { position: number; id: string; bot: boolean };
type Live = {
  createdAt: Date;
  battle: ReBattle;
  seats: Seat[];
  pot: number;
  rounds: number;
  dropCents: number;
  /** `battles:finished`, kept so a late `caseBattleWinner` can re-settle with the site's figures. */
  finished: ReBattleFinished | null;
  finishedAt: Date | null;
  winner: ReBattleWinner | null;
};

const live = new Map<string, Live>();
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** How long a finished battle stays around for its winner event. */
const LINGER_MS = 5 * 60 * 1000;

const room = (key: string) => `battle-${key}`;

function drop(key: string, ctx: AdapterContext) {
  if (live.delete(key)) ctx.emit("leaveRoom", room(key));
}

function sweep(now: Date, ctx: AdapterContext) {
  for (const [k, b] of live) {
    const age = now.getTime() - (b.finishedAt ?? b.createdAt).getTime();
    if (age > (b.finishedAt ? LINGER_MS : MAX_AGE_MS)) drop(k, ctx);
  }
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
  sweep(receivedAt, ctx);
  let cur = live.get(b.url_key);
  if (!cur) {
    cur = { createdAt: b.created_at ? new Date(b.created_at) : receivedAt, battle: b, seats: [], pot: 0, rounds: 0, dropCents: 0, finished: null, finishedAt: null, winner: null };
    live.set(b.url_key, cur);
    ctx.emit("joinRoom", room(b.url_key));
  }
  cur.battle = b;
  const s = seats(b, receivedAt, ctx);
  if (s.length > cur.seats.length) cur.seats = s;
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

/** `caseBattleWinner` from the battle's own room: the site's prize figures. Settles (again) if the battle already finished. */
export function handleBattleWinner(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const w = payload as ReBattleWinner;
  const key = w?.battleId ?? w?.gameId ?? w?.url_key;
  const b = key ? live.get(String(key)) : undefined;
  if (!b || !w.winnerPrize) return;
  b.winner = w;
  if (b.finished) settle(b, b.finished, receivedAt, ctx);
}

export function handleBattleFinished(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const f = payload as ReBattleFinished;
  const b = f?.battleId ? live.get(String(f.battleId)) : undefined;
  if (!b) return;
  b.finished = f;
  b.finishedAt = receivedAt;
  settle(b, f, receivedAt, ctx);
}

/** The site's `winnerPrize` read the way its battle page does: `winnings` is one winner's prize, or the whole team's in team mode. */
function prizeFor(b: Live, position: number, won: Set<number>): number | null {
  const p = b.winner?.winnerPrize;
  if (!p || typeof p.winnings !== "number" || !won.has(position)) return null;
  const layout = SEATS[Number(b.battle.mode)];
  return p.mode === "team" && layout ? p.winnings / layout.teamSize : p.winnings;
}

function settle(b: Live, f: ReBattleFinished, receivedAt: Date, ctx: AdapterContext) {
  const cases = Number(b.battle.case_count) || 0;
  if (!b.seats.length || b.rounds < cases) {
    ctx.log.debug({ battleId: f.battleId, rounds: b.rounds, cases, seats: b.seats.length }, "battle finished with rounds or seats missing, skipped");
    drop(String(f.battleId), ctx);
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
    // Bots never borrow; a real seat keeps the fraction it paid for.
    const payout = isWinner ? (s.bot ? share : share * (1 - borrow / 100)) : 0;
    const site = prizeFor(b, s.position, won);
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
        grossShareUsd: usd(isWinner ? share : 0),
        siteWinningsUsd: site == null ? null : usd(site),
        cases,
        winner: f.winner ?? null,
        onWinningTeam: isWinner,
        battleNo: b.battle.id ?? null,
      },
    });
  }
  // Keep the battle until its winner event arrives (or a while passes), so the site's figures can replace the formula.
  if (b.winner) drop(roundId, ctx);
}
