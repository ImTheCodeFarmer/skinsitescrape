/**
 * Case battles, channel "battles". The feed gives the whole lobby on
 * `battles:new`, seats on `battles:join`, a `battles:join-bots` once the
 * creator fills the rest with bots, `battles:start`, one `battles:round` per
 * case with a drop for every seat, and `battles:finished` with the winning
 * team.
 *
 * Every seat pays `joinPrice`. The winning team splits the value of every
 * drop in the battle: each winner gets floor(total / teamSize), the client's
 * own formula. Group mode puts everyone on team 1, so it is the same formula
 * with no losers; crazy, terminal and jackpot modes only change who
 * `winningTeam` is.
 *
 * A player may take the seat on a loan (`borrowMultiplier` > 1): they pay a
 * fraction of the price and keep a smaller fraction of the winnings, see
 * site.ts. The bet row stores what the player paid and what they kept; the
 * seat's gross figures go in meta.
 *
 * There is no lobby list on the socket (the page loads it over HTTP), so a
 * battle already running when we connect is never settled. Double-downs
 * (`battles:double-down`) are kept raw only.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type FamilySite, loanShare, loanStake, seen, seenBot } from "./site.js";
import type { CgBattle, CgBattleFinished, CgBattleJoin, CgBattlePlayer, CgBattleRound, CgBattleStart } from "./types.js";

type Live = {
  createdAt: Date;
  info: Pick<CgBattle, "mode" | "currency" | "joinPrice" | "prediscountPrice" | "teamSize" | "playerCount" | "isSuperSpin" | "isFastSpin" | "isJackpot" | "isBonusBattle" | "isPrivate">;
  cases: number;
  players: Map<number, CgBattlePlayer>;
  dropCents: number;
  rounds: number;
  seed: string | null;
};

const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function battles(site: FamilySite) {
  const live = new Map<number, Live>();

  const sweep = (now: Date) => {
    for (const [id, b] of live) if (now.getTime() - b.createdAt.getTime() > MAX_AGE_MS) live.delete(id);
  };

  const playerId = (p: CgBattlePlayer, at: Date, ctx: AdapterContext): string | null => {
    if (p.user) return seen(site, p.user, at, ctx);
    if (p.botId != null) return seenBot(site, p.botId, at, ctx);
    return null;
  };

  function onNew(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
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

  function onJoin(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
    const p = payload as CgBattleJoin;
    const b = p?.battleId ? live.get(p.battleId) : undefined;
    if (!b || !p.id) return;
    b.players.set(p.id, p);
    playerId(p, receivedAt, ctx);
  }

  /**
   * `battles:join-bots` carries only the battle id. The client fills every
   * empty seat with a bot, team by team, numbering them from 1 in that
   * order; the drops confirm the numbering, so the same fill is done here.
   * Seat ids for bots are negative so they cannot collide with real seats.
   */
  function onJoinBots(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
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
        seenBot(site, n, receivedAt, ctx);
        n++;
      }
    }
  }

  function onStart(payload: unknown) {
    const s = payload as CgBattleStart;
    const b = s?.battleId ? live.get(s.battleId) : undefined;
    if (b) b.seed = s.seed ?? null;
  }

  function onRound(payload: unknown) {
    const r = payload as CgBattleRound;
    const b = r?.battleId ? live.get(r.battleId) : undefined;
    if (!b || !Array.isArray(r.drops)) return;
    b.rounds += 1;
    for (const d of r.drops) b.dropCents += Number(d?.item?.price) || 0;
  }

  /** Settle every seat. Skipped when we did not see every round (connected mid-battle). */
  function onFinished(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
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
      const onWinningTeam = p.team === f.winningTeam;
      const gross = onWinningTeam ? share : 0;
      const stake = Math.round(loanStake(b.info.joinPrice, t));
      const payout = Math.round(gross * loanShare(t));
      // `won` is "came out ahead", which the rollups count on: in group mode every
      // seat is on the winning team, and a winner's drops can be worth less than the seat.
      ctx.sink.bet({
        site: site.slug,
        game: "battles",
        externalId: `${roundId}:${pid}`,
        roundId,
        playerId: pid,
        isHouse: p.botId != null,
        wageredUsd: site.usd(stake),
        payoutUsd: site.usd(payout),
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
          onWinningTeam,
          isCoinflip: f.isCoinflip,
          isJackpot: f.isJackpot,
          isBonusBattle: b.info.isBonusBattle ?? false,
          prediscountPrice: b.info.prediscountPrice,
          seed: b.seed,
        },
      });
    }
  }

  return { onNew, onJoin, onJoinBots, onStart, onRound, onFinished };
}
