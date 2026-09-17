/**
 * Spinner Battles, room "spinners": 2 to 4 players stake the same amount on a
 * colour, one ticket draw picks the winner. Events: `new` (the lobby with its
 * creator), `joined` per seat (bots carry `bot: true`), `lock`, `roll` with
 * `data.winner`, and `expired` with lobby ids. The snapshot sent on
 * subscribe also lists recently finished games, which are settled too (the
 * upsert makes that harmless).
 *
 * The winner takes the pot less the rake from `app.conga` (5% on
 * 2026-09-17; the wins ticker showed 950 on a 2 × 500 game). Some games
 * never reach this room and only show in the wins ticker, presumably private
 * lobbies; those are not tracked.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, isBot, seen, usd, type BcUser } from "./site.js";

type BcSpinPlayer = BcUser & { color?: string; amount?: number };
type BcSpin = { id: string; status?: number; slots?: number; players?: Record<string, BcSpinPlayer>; createdAt?: string; rolledAt?: string; outcome?: number | null; data?: { winner?: string | null; creator?: string } };

let rake = 0.05;
export const setSpinnerRake = (v: unknown) => {
  if (typeof v === "number" && v >= 0 && v < 1) rake = v;
};

type Live = { createdAt: Date; slots: number; players: Map<string, BcSpinPlayer> };
const live = new Map<string, Live>();
const MAX_AGE_MS = 60 * 60 * 1000;

function track(g: BcSpin, at: Date, ctx: AdapterContext): Live | null {
  if (!g?.id) return null;
  const cur = live.get(g.id) ?? { createdAt: g.createdAt ? new Date(g.createdAt) : at, slots: Number(g.slots) || 0, players: new Map() };
  for (const p of Object.values(g.players ?? {})) if (seen(p, at, ctx)) cur.players.set(String(p.steamid), p);
  live.set(g.id, cur);
  return cur;
}

export function handleSpinActive(payload: unknown, at: Date, ctx: AdapterContext) {
  if (!Array.isArray(payload)) return;
  for (const [k, g] of live) if (at.getTime() - g.createdAt.getTime() > MAX_AGE_MS) live.delete(k);
  for (const g of payload as BcSpin[]) {
    track(g, at, ctx);
    if (g.data?.winner) settle(g.id, g.data.winner, g.outcome ?? null, g.rolledAt ? new Date(g.rolledAt) : at, ctx);
  }
}

export const handleSpinNew = (payload: unknown, at: Date, ctx: AdapterContext) => void track(payload as BcSpin, at, ctx);

export function handleSpinJoined(payload: unknown, at: Date, ctx: AdapterContext) {
  const j = payload as { id?: string; player?: BcSpinPlayer };
  const g = j?.id ? live.get(j.id) : undefined;
  if (g && j.player && seen(j.player, at, ctx)) g.players.set(String(j.player.steamid), j.player);
}

export function handleSpinExpired(payload: unknown) {
  for (const id of Array.isArray(payload) ? payload : [payload]) live.delete(String(id));
}

export function handleSpinRoll(payload: unknown, at: Date, ctx: AdapterContext) {
  const r = payload as { id?: string; outcome?: number; data?: { winner?: string | null } };
  if (r?.id && r.data?.winner) settle(r.id, r.data.winner, r.outcome ?? null, at, ctx);
}

function settle(id: string, winner: string, outcome: number | null, at: Date, ctx: AdapterContext) {
  const g = live.get(id);
  if (!g) return;
  live.delete(id);
  if (!g.players.has(winner) || (g.slots && g.players.size < g.slots)) {
    ctx.log.debug({ gameId: id, seats: g.players.size, slots: g.slots }, "spinner game with seats missing, skipped");
    return;
  }
  const pot = [...g.players.values()].reduce((a, p) => a + (Number(p.amount) || 0), 0);
  for (const p of g.players.values()) {
    const pid = String(p.steamid);
    const won = pid === winner;
    ctx.sink.bet({
      site: SITE,
      game: "spinners",
      externalId: `${id}:${pid}`,
      roundId: id,
      playerId: pid,
      isHouse: isBot(pid, p.bot),
      wageredUsd: usd(p.amount),
      payoutUsd: usd(won ? pot * (1 - rake) : 0),
      won,
      placedAt: g.createdAt,
      settledAt: at,
      meta: { color: p.color ?? null, players: g.players.size, potUsd: usd(pot), rake, outcome },
    });
  }
}
