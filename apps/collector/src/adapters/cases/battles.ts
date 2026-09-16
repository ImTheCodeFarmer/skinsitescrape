/**
 * Case battles on the main socket, channel "battles". The feed gives the
 * whole lobby on `battles:new`, seats on `battles:join`, a `battles:join-bots`
 * once the creator fills the rest with bots, `battles:start`, one
 * `battles:round` per case with a drop for every seat, and
 * `battles:finished` with the winning team.
 *
 * Every seat pays `joinPrice`. The winning team splits the value of every
 * drop in the battle: each winner gets floor(total / teamSize) — the site's
 * own client uses exactly that (module "b" in the battle page chunk). Group
 * mode puts everyone on team 1, so it is the same formula with no losers;
 * crazy, terminal and jackpot modes only change who `winningTeam` is.
 *
 * A player may take the seat on a loan (`borrowMultiplier` > 1): they pay a
 * fraction of the price and keep a smaller fraction of the winnings, see
 * site.ts. The bet row stores what the player paid and what they kept; the
 * seat's gross figures go in meta.
 *
 * There is no lobby list on the socket (the site's page loads it over HTTP),
 * so a battle already running when we connect is never settled; they last a
 * few minutes. `battles:double-down` is kept raw only.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, loanShare, loanStake, seen, seenBot, usd } from "./site.js";
import type { CgBattle, CgBattleFinished, CgBattleJoin, CgBattlePlayer, CgBattleRound, CgBattleStart } from "./types.js";

type Live = {
  createdAt: Date;
  info: Pick<CgBattle, "mode" | "currency" | "joinPrice" | "prediscountPrice" | "teamSize" | "playerCount" | "isSuperSpin" | "isFastSpin" | "isJackpot" | "isBonusBattle" | "isPrivate">;
  /** Cases in play; a round is one case. */
  cases: number;
  players: Map<number, CgBattlePlayer>;
  /** Cents of every drop so far, and rounds seen. */
  dropCents: number;
  rounds: number;
  seed: string | null;
};

const live = new Map<number, Live>();
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function sweep(now: Date) {
  for (const [id, b] of live) if (now.getTime() - b.createdAt.getTime() > MAX_AGE_MS) live.delete(id);
}

function playerId(p: CgBattlePlayer, at: Date, ctx: AdapterContext): string | null {
  if (p.user) return seen(p.user, at, ctx);
  if (p.botId != null) return seenBot(p.botId, at, ctx);
  return null;
}

export function handleBattleNew(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const b = payload as CgBattle;
  const id = b?.id ?? b?.battleId;
  if (!id) return;
  sweep(receivedAt);
  const info: Live["info"] = {
    mode: b.mode, currency: b.currency, joinPrice: b.joinPrice, prediscountPrice: b.prediscountPrice ?? null, teamSize: b.teamSize, playerCount: b.playerCount,
    isSuperSpin: b.isSuperSpin, isFastSpin: b.isFastSpin, isJackpot: b.isJackpot, isBonusBattle: b.isBonusBattle, isPrivate: b.isPrivate,
  };
  const cur: Live = live.get(id) ?? { createdAt: b.createdAt ? new Date(b.createdAt) : receivedAt, info, cases: 0, players: new Map(), dropCents: 0, rounds: 0, seed: null };
  cur.info = info;
  cur.cases = (b.cases ?? []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
  for (const p of b.players ?? []) {
    cur.players.set(p.id, p);
    playerId(p, receivedAt, ctx);
  }
  live.set(id, cur);
}

export function handleBattleJoin(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const p = payload as CgBattleJoin;
  const b = p?.battleId ? live.get(p.battleId) : undefined;
  if (!b || !p.id) return;
  b.players.set(p.id, p);
  playerId(p, receivedAt, ctx);
}

/**
 * `battles:join-bots` carries only the battle id. The site's client fills
 * every empty seat with a bot, team by team, numbering them from 1 in that
 * order; the drops confirm the numbering, so the same fill is done here.
 * Seat ids for bots are negative so they cannot collide with real seats.
 */
export function handleBattleJoinBots(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const id = (payload as { battleId?: number })?.battleId;
  const b = id ? live.get(id) : undefined;
  if (!b) return;
  const perTeam = new Map<number, number>();
  for (const p of b.players.values()) perTeam.set(p.team, (perTeam.get(p.team) ?? 0) + 1);
  const teams = Math.floor(b.info.playerCount / b.info.teamSize);
  let n = 1;
  for (let team = 1; team <= teams; team++) {
    for (let k = perTeam.get(team) ?? 0; k < b.info.teamSize; k++) {
      const bot: CgBattlePlayer = { id: -n, team, botId: n, borrowMultiplier: 1, user: null, currency: null };
      b.players.set(bot.id, bot);
      seenBot(n, receivedAt, ctx);
      n++;
    }
  }
}

export function handleBattleStart(payload: unknown) {
  const s = payload as CgBattleStart;
  const b = s?.battleId ? live.get(s.battleId) : undefined;
  if (b) b.seed = s.seed ?? null;
}

export function handleBattleRound(payload: unknown) {
  const r = payload as CgBattleRound;
  const b = r?.battleId ? live.get(r.battleId) : undefined;
  if (!b || !Array.isArray(r.drops)) return;
  b.rounds += 1;
  for (const d of r.drops) b.dropCents += Number(d?.item?.price) || 0;
}

/** Settle every seat. Skipped when we did not see every round (connected mid-battle). */
export function handleBattleFinished(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const f = payload as CgBattleFinished;
  const b = f?.battleId ? live.get(f.battleId) : undefined;
  if (!b) return;
  live.delete(f.battleId);
  if (b.info.currency !== "REAL") return;
  if (b.rounds < b.cases) {
    ctx.log.debug({ battleId: f.battleId, rounds: b.rounds, cases: b.cases }, "battle finished with rounds missing, skipped");
    return;
  }
  const roundId = String(f.battleId);
  const share = Math.floor(b.dropCents / Math.max(1, b.info.teamSize));
  for (const p of b.players.values()) {
    const pid = playerId(p, receivedAt, ctx);
    if (!pid) continue;
    const t = Math.max(1, Number(p.borrowMultiplier) || 1);
    const won = p.team === f.winningTeam;
    const gross = won ? share : 0;
    const stake = Math.round(loanStake(b.info.joinPrice, t));
    const payout = Math.round(gross * loanShare(t));
    // `won` is "came out ahead", which the rollups count on: in group mode every
    // seat is on the winning team, and a winner's drops can be worth less than the seat.
    ctx.sink.bet({
      site: SITE,
      game: "battles",
      externalId: `${roundId}:${pid}`,
      roundId,
      playerId: pid,
      isHouse: p.botId != null,
      wageredUsd: usd(stake),
      payoutUsd: usd(payout),
      won: payout > stake,
      placedAt: b.createdAt,
      settledAt: receivedAt,
      meta: {
        team: p.team,
        seatId: p.id,
        borrowMultiplier: t,
        seatCents: b.info.joinPrice,
        grossPayoutCents: gross,
        potCents: b.dropCents,
        mode: b.info.mode,
        teamSize: b.info.teamSize,
        seats: b.info.playerCount,
        cases: b.cases,
        winningTeam: f.winningTeam,
        onWinningTeam: won,
        isCoinflip: f.isCoinflip,
        isJackpot: f.isJackpot,
        isBonusBattle: b.info.isBonusBattle ?? false,
        prediscountPrice: b.info.prediscountPrice,
        seed: b.seed,
      },
    });
  }
}
