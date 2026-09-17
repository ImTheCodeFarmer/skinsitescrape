/**
 * Crate Battles, room "caseBattles". Subscribing sends `active` (every open
 * or running battle, players included), then per battle `new`,
 * `playerJoined` per seat (bots carry `bot: true`), `lock`, one `rollRound`
 * per case (not needed, never stored) and `finished` with `winningTeams` and
 * `totalWon`, or `expired` with the ids of lobbies that timed out.
 *
 * Every seat on a winning team, bots included, takes an equal share of
 * `totalWon` (the rule the legacy scraper used; it also covers jackpot mode,
 * where `winningTeams` names the drawn team, and group unboxes, where the one
 * team holds every seat). A seat costs `price`. With `funding` the creator
 * sponsors that percentage of every other seat: joiners pay the site's
 * `joinPrice` (price − ceil(price × funding%)) and the difference is added to
 * the creator's stake. That the creator also covers seats later filled by
 * bots is an assumption.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, isBot, seen, usd, type BcUser } from "./site.js";

type BcBattlePlayer = BcUser & { team?: number };
type BcBattle = {
  id: string;
  creatorId?: string;
  status?: number;
  price?: number;
  createdAt?: string;
  config?: { slots?: number; teams?: { id: number; slots: number }[]; cursed?: boolean; lastCase?: boolean; jackpot?: boolean; funding?: number; private?: boolean; rounds?: string[]; fastMode?: boolean };
  players?: Record<string, BcBattlePlayer>;
};
type BcFinished = { id: string; winningTeams?: number[]; totalWon?: number; jackpotData?: { winningTeam?: number } };

type Live = { battle: BcBattle; createdAt: Date; players: Map<string, BcBattlePlayer> };
const live = new Map<string, Live>();
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function track(b: BcBattle, at: Date, ctx: AdapterContext) {
  if (!b?.id) return;
  const cur = live.get(b.id) ?? { battle: b, createdAt: b.createdAt ? new Date(b.createdAt) : at, players: new Map() };
  cur.battle = b;
  for (const p of Object.values(b.players ?? {})) if (seen(p, at, ctx)) cur.players.set(String(p.steamid), p);
  live.set(b.id, cur);
}

export function handleBattleActive(payload: unknown, at: Date, ctx: AdapterContext) {
  if (!Array.isArray(payload)) return;
  for (const [k, b] of live) if (at.getTime() - b.createdAt.getTime() > MAX_AGE_MS) live.delete(k);
  for (const b of payload as BcBattle[]) track(b, at, ctx);
}

export const handleBattleNew = (payload: unknown, at: Date, ctx: AdapterContext) => track(payload as BcBattle, at, ctx);

export function handleBattleJoined(payload: unknown, at: Date, ctx: AdapterContext) {
  const j = payload as { id?: string; player?: BcBattlePlayer };
  const b = j?.id ? live.get(j.id) : undefined;
  if (b && j.player && seen(j.player, at, ctx)) b.players.set(String(j.player.steamid), j.player);
}

export function handleBattleExpired(payload: unknown) {
  for (const id of Array.isArray(payload) ? payload : [payload]) live.delete(String((id as { id?: string })?.id ?? id));
}

export function handleBattleFinished(payload: unknown, at: Date, ctx: AdapterContext) {
  const f = payload as BcFinished;
  const b = f?.id ? live.get(f.id) : undefined;
  if (!b) return;
  live.delete(f.id);
  const cfg = b.battle.config ?? {};
  const slots = Number(cfg.slots) || b.players.size;
  if (b.players.size < slots) {
    ctx.log.debug({ battleId: f.id, seats: b.players.size, slots }, "battle finished with seats missing, skipped");
    return;
  }
  const price = Number(b.battle.price) || 0;
  const funding = Math.min(100, Math.max(0, Number(cfg.funding) || 0));
  const funded = funding ? Math.ceil(price * (funding / 100)) : 0;
  const winning = new Set((f.winningTeams ?? []).map(Number));
  const seats = [...b.players.values()];
  const winners = seats.filter((p) => winning.has(Number(p.team))).length;
  const share = winners ? (Number(f.totalWon) || 0) / winners : 0;
  for (const p of seats) {
    const id = String(p.steamid);
    const creator = id === b.battle.creatorId;
    const stake = creator ? price + funded * (slots - 1) : price - funded;
    const won = winning.has(Number(p.team));
    ctx.sink.bet({
      site: SITE,
      game: "battles",
      externalId: `${f.id}:${id}`,
      roundId: f.id,
      playerId: id,
      isHouse: isBot(id, p.bot),
      wageredUsd: usd(stake),
      payoutUsd: usd(won ? share : 0),
      won: won && share > stake,
      placedAt: b.createdAt,
      settledAt: at,
      meta: {
        team: p.team ?? null,
        mode: (cfg.teams ?? []).map((t) => t.slots).join("v"),
        cursed: Boolean(cfg.cursed),
        jackpot: Boolean(cfg.jackpot),
        lastCase: Boolean(cfg.lastCase),
        private: Boolean(cfg.private),
        seatUsd: usd(price),
        fundingPercent: funding,
        creator,
        cases: cfg.rounds?.length ?? null,
        potUsd: usd(f.totalWon),
        winningTeams: f.winningTeams ?? [],
        onWinningTeam: won,
      },
    });
  }
}
