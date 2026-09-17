/**
 * Crate Royale, room "caseJackpot": three standing rooms (primlocked, medium,
 * highrollers). An entry buys and opens up to a few crates; what they unbox
 * goes into the pot and sets the entry's tickets. `roll` names the winning
 * entry, which takes everything unboxed plus the round's `bonus` when there
 * is one. Checked on 2026-09-17: 106+170+106+106+27+134 unboxed and a bonus
 * of 164 paid the 813 that `recentWin.totalWon` reported. The house edge is
 * in the crates, so there is no rake; the site's bots ("bandits") enter too.
 *
 * Entries only arrive as they happen, so a round already populated when we
 * connect is skipped: `game.caseJackpot.active.stats` tells which those are.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, isBot, objectIdTime, seen, usd, type BcUser } from "./site.js";

type BcCaseRoll = { caseId?: string; price?: number; item?: string; won?: number };
type BcEntry = { entryId: string; userId: string; joinedAt?: number; cases?: BcCaseRoll[] };
type BcGame = { id: string; config?: { slug?: string }; createdAt?: string };

type Live = { slug: string | null; createdAt: Date; complete: boolean; entries: Map<string, BcEntry> };
const live = new Map<string, Live>();

function track(g: BcGame, at: Date, complete: boolean) {
  if (!g?.id || live.has(g.id)) return;
  if (live.size > 50) for (const k of [...live.keys()].slice(0, live.size - 50)) live.delete(k);
  live.set(g.id, { slug: g.config?.slug ?? null, createdAt: g.createdAt ? new Date(g.createdAt) : objectIdTime(g.id, at), complete, entries: new Map() });
}

/** Snapshot on subscribe: rounds in progress, entries unknown until the stats reply says they are empty. */
export function handleRoyaleActive(payload: unknown, at: Date) {
  for (const g of Object.values((payload ?? {}) as Record<string, BcGame>)) track(g, at, false);
}

/** Reply to `game.caseJackpot.active.stats`: `{gameId: {totalUnboxed, playerCount}}`. */
export function handleRoyaleStats(payload: unknown): boolean {
  const stats = payload as Record<string, { playerCount?: number; totalUnboxed?: number }> | null;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const rows = Object.entries(stats);
  if (!rows.length || !rows.every(([, s]) => s && typeof s === "object" && "playerCount" in s)) return false;
  for (const [id, s] of rows) {
    const g = live.get(id);
    if (g && !g.entries.size && !Number(s.playerCount)) g.complete = true;
  }
  return true;
}

export const handleRoyaleNew = (payload: unknown, at: Date) => track(payload as BcGame, at, true);

export function handleRoyaleEntry(payload: unknown, at: Date, ctx: AdapterContext) {
  const e = payload as { gameId?: string; entry?: BcEntry; publicUser?: BcUser };
  const g = e?.gameId ? live.get(e.gameId) : undefined;
  if (!e?.entry?.entryId) return;
  seen(e.publicUser ?? { steamid: e.entry.userId }, at, ctx);
  g?.entries.set(e.entry.entryId, e.entry);
}

export function handleRoyaleRoll(payload: unknown, at: Date, ctx: AdapterContext) {
  const r = payload as { gameId?: string; winningEntryId?: string; winningTicket?: number; bonus?: number | null };
  const g = r?.gameId ? live.get(r.gameId) : undefined;
  if (!g) return;
  live.delete(r.gameId!);
  if (!g.complete || !g.entries.size) {
    ctx.log.debug({ gameId: r.gameId, entries: g.entries.size }, "royale round joined midway, skipped");
    return;
  }
  const unboxed = (e: BcEntry) => (e.cases ?? []).reduce((a, c) => a + (Number(c.won) || 0), 0);
  const bonus = Math.max(0, Number(r.bonus) || 0);
  const pot = [...g.entries.values()].reduce((a, e) => a + unboxed(e), 0) + bonus;
  for (const e of g.entries.values()) {
    const stake = (e.cases ?? []).reduce((a, c) => a + (Number(c.price) || 0), 0);
    const won = e.entryId === r.winningEntryId;
    ctx.sink.bet({
      site: SITE,
      game: "royale",
      externalId: e.entryId,
      roundId: r.gameId,
      playerId: String(e.userId),
      isHouse: isBot(String(e.userId)),
      wageredUsd: usd(stake),
      payoutUsd: usd(won ? pot : 0),
      won: won && pot > stake,
      placedAt: e.joinedAt ? new Date(e.joinedAt) : g.createdAt,
      settledAt: at,
      meta: { room: g.slug, crates: e.cases?.length ?? 0, unboxedUsd: usd(unboxed(e)), potUsd: usd(pot), bonusUsd: usd(bonus), entries: g.entries.size, winningTicket: r.winningTicket ?? null },
    });
  }
}
