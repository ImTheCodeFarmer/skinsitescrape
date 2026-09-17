/**
 * The smaller rooms: Wheel, PVP Mines and Coinflip.
 *
 * Wheel (`wheel:connect`): `wheel:updateState` walks a round through open,
 * spinning and ended, and always carries every bet, keyed by colour and
 * user. Colours pay gray 2x, blue 3x, purple 6x, green 12x, yellow 22x (the
 * client's table); when the winning tile is one of the round's zapped tiles
 * the payout is multiplied by `zapMultiplier` (again the client's own rule).
 *
 * PVP Mines (`pvpmines:connect`): `pvpmines:update` carries the whole game;
 * when it ends every seat has staked `value` and `winner.value` is what the
 * winner received (180 on a 2 × 100 game: a 10% rake). Bots have id 0.
 *
 * Coinflip (`coinflip:connect`) is an item flip: `coinflip:update` carries
 * the game, ended games have `winner` and `total`. The winner is credited
 * the whole pot; whatever the site keeps is not on the feed
 * (`meta.taxUnknown`). About one game an hour.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, seen, seenBot, usd } from "./site.js";

export const WHEEL_MULTIPLIER: Record<string, number> = { gray: 2, blue: 3, purple: 6, green: 12, yellow: 22 };

type RlWheelBet = { userId?: number | string; username?: string; avatar?: string; bet?: number };
type RlWheelState = {
  status?: string;
  id?: number;
  tileColorBets?: Record<string, Record<string, RlWheelBet>>;
  spinStartTime?: number;
  winningTile?: number | null;
  winningTileColor?: string | null;
  zapTile1?: number | null;
  zapTile2?: number | null;
  zapMultiplier?: number | null;
};

let lastWheel: number | null = null;

export function handleWheelState(payload: unknown, at: Date, ctx: AdapterContext) {
  const g = (payload as { gameState?: RlWheelState })?.gameState;
  if (!g || g.status !== "ended" || g.id == null || !g.winningTileColor || g.id === lastWheel) return;
  lastWheel = g.id;
  const zapped = g.winningTile != null && (g.winningTile === g.zapTile1 || g.winningTile === g.zapTile2);
  const zap = zapped ? Number(g.zapMultiplier) || 1 : 1;
  const players = new Map<string, { stake: number; payout: number; bets: Record<string, number> }>();
  for (const [color, sheet] of Object.entries(g.tileColorBets ?? {})) {
    for (const b of Object.values(sheet ?? {})) {
      const id = seen({ id: b.userId, name: b.username, avatar: b.avatar }, at, ctx);
      const bet = Number(b.bet) || 0;
      if (!id || bet <= 0) continue;
      const p = players.get(id) ?? { stake: 0, payout: 0, bets: {} };
      p.stake += bet;
      p.bets[color] = (p.bets[color] ?? 0) + bet;
      if (color === g.winningTileColor) p.payout += bet * (WHEEL_MULTIPLIER[color] ?? 0) * zap;
      players.set(id, p);
    }
  }
  const roundId = String(g.id);
  for (const [id, p] of players) {
    ctx.sink.bet({
      site: SITE,
      game: "wheel",
      externalId: `${roundId}:${id}`,
      roundId,
      playerId: id,
      wageredUsd: usd(p.stake),
      payoutUsd: usd(p.payout),
      won: p.payout > p.stake,
      placedAt: g.spinStartTime ? new Date(g.spinStartTime) : at,
      settledAt: at,
      meta: { color: g.winningTileColor, tile: g.winningTile, zapMultiplier: zap, bets: p.bets },
    });
  }
}

type RlMinesPlayer = { index: number; id?: number | string; username?: string; avatar?: string; bot?: boolean; eliminated?: boolean };
type RlMines = { value?: number; mode?: string; mines?: number; playersAmount?: number; status?: string; players?: Record<string, RlMinesPlayer>; winner?: { player?: RlMinesPlayer; value?: number } };

const settledMines = new Set<string>();

export function handlePvpMines(payload: unknown, at: Date, ctx: AdapterContext) {
  const u = payload as { gameId?: number | string; data?: RlMines };
  const g = u?.data;
  if (u?.gameId == null || g?.status !== "ended" || !g.winner?.player) return;
  const roundId = String(u.gameId);
  if (settledMines.has(roundId)) return;
  if (settledMines.size > 5000) settledMines.clear();
  settledMines.add(roundId);
  const seats = Object.values(g.players ?? {});
  for (const p of seats) {
    const bot = Boolean(p.bot) || String(p.id ?? "0") === "0";
    const playerId = bot ? seenBot("pvpmines", p.index, at, ctx) : seen({ id: p.id, name: p.username, avatar: p.avatar }, at, ctx);
    if (!playerId) continue;
    const won = Number(p.index) === Number(g.winner.player.index);
    ctx.sink.bet({
      site: SITE,
      game: "pvpmines",
      externalId: `${roundId}:${p.index}`,
      roundId,
      playerId,
      isHouse: bot,
      wageredUsd: usd(g.value),
      payoutUsd: usd(won ? g.winner.value : 0),
      won,
      placedAt: at,
      settledAt: at,
      meta: { mode: g.mode ?? null, mines: g.mines ?? null, players: seats.length, potUsd: usd((Number(g.value) || 0) * seats.length) },
    });
  }
}

type RlFlipSide = { id?: number | string; username?: string; avatar?: string; side?: number; value?: number; bot?: boolean };
type RlFlip = { status?: string; id?: number | string; creator?: RlFlipSide; opponent?: RlFlipSide; winner?: { side?: number }; total?: number; startTime?: number; ticket?: number };

export function handleCoinflip(payload: unknown, at: Date, ctx: AdapterContext) {
  const u = payload as { id?: number | string; data?: RlFlip };
  const g = u?.data;
  if (u?.id == null || g?.status !== "ended" || !g.creator || !g.opponent || g.winner?.side == null) return;
  const roundId = String(u.id);
  const total = Number(g.total) || (Number(g.creator.value) || 0) + (Number(g.opponent.value) || 0);
  for (const [role, s] of [["creator", g.creator], ["opponent", g.opponent]] as const) {
    const bot = Boolean(s.bot);
    const playerId = bot ? seenBot("coinflip", role, at, ctx) : seen({ id: s.id, name: s.username, avatar: s.avatar }, at, ctx);
    if (!playerId) continue;
    const won = s.side === g.winner.side;
    ctx.sink.bet({
      site: SITE,
      game: "coinflip",
      externalId: `${roundId}:${role}`,
      roundId,
      playerId,
      isHouse: bot,
      wageredUsd: usd(s.value),
      payoutUsd: usd(won ? total : 0),
      won,
      placedAt: g.startTime ? new Date(g.startTime) : at,
      settledAt: at,
      meta: { role, side: s.side ?? null, potUsd: usd(total), ticket: g.ticket ?? null, taxUnknown: true },
    });
  }
}
