import "server-only";
import { sql } from "@casino/db";
import { db } from "./db";

/**
 * Admin-marked players (players.is_admin, migration 0017). A site's owner or
 * staff can bet with money that was never deposited, so their play says
 * nothing about the site's profit. Their bets are still collected but are
 * stored with is_house, which every aggregate already filters on; marking a
 * player flips that flag on the bets they already have, and the collector
 * writes their new bets with it from then on.
 */
export type AdminPlayer = { site: string; id: string; handle: string; avatar: string | null; bets: number; lastSeen: string | null };

const DAY = 86_400_000;

export async function isAdminPlayer(site: string, id: string): Promise<boolean> {
  const r = (await db().execute(sql`SELECT is_admin FROM players WHERE site = ${site} AND external_id = ${id}`)) as unknown as { is_admin: boolean }[];
  return Boolean(r[0]?.is_admin);
}

export async function listAdminPlayers(): Promise<AdminPlayer[]> {
  const r = (await db().execute(sql`
    SELECT p.site, p.external_id, p.display_name, p.avatar, p.last_seen,
           (SELECT count(*) FROM bets b WHERE b.site = p.site AND b.player_id = p.external_id) AS bets
    FROM players p WHERE p.is_admin ORDER BY p.last_seen DESC`)) as unknown as Record<string, unknown>[];
  return r.map((x) => ({
    site: String(x.site), id: String(x.external_id), handle: x.display_name == null ? String(x.external_id) : String(x.display_name),
    avatar: x.avatar == null ? null : String(x.avatar), bets: Number(x.bets), lastSeen: x.last_seen ? new Date(x.last_seen as string).toISOString() : null,
  }));
}

/**
 * Mark or unmark a player. Returns how many bets changed and the earliest
 * one, so the caller can refresh the aggregates over that span. The house
 * bots cannot be marked: their bets are excluded already and unmarking
 * would put them back.
 */
export async function setAdminPlayer(site: string, id: string, admin: boolean): Promise<{ ok: true; bets: number; from: Date | null } | { ok: false; error: string }> {
  const p = (await db().execute(sql`SELECT is_house FROM players WHERE site = ${site} AND external_id = ${id}`)) as unknown as { is_house: boolean }[];
  if (!p.length) return { ok: false, error: "Unknown player." };
  if (p[0].is_house) return { ok: false, error: "That is the house bot; its bets never count." };
  await db().execute(sql`UPDATE players SET is_admin = ${admin} WHERE site = ${site} AND external_id = ${id}`);
  const r = (await db().execute(sql`
    WITH u AS (
      UPDATE bets SET is_house = ${admin} WHERE site = ${site} AND player_id = ${id} AND is_house <> ${admin} RETURNING placed_at)
    SELECT count(*) AS n, min(placed_at) AS t FROM u`)) as unknown as { n: string; t: string | null }[];
  return { ok: true, bets: Number(r[0]?.n ?? 0), from: r[0]?.t ? new Date(r[0].t) : null };
}

/**
 * Recompute the bet aggregates from `from` onwards. The refresh policies
 * only look back a few days, so buckets older than that would otherwise
 * keep the player's bets until the next full refresh. Only buckets the
 * update touched are recomputed, in weekly windows so a long history does
 * not hold one lock. Runs outside a transaction (Timescale requires it).
 */
export async function refreshAggregatesFrom(from: Date, log: (msg: string) => void = () => {}) {
  const plan = [
    { view: "bets_hourly", stepDays: 7 },
    { view: "player_daily", stepDays: 7 },
    { view: "bets_daily", stepDays: 30 }, // stacked on bets_hourly, so after it
    { view: "bets_daily_records", stepDays: 30 },
  ];
  const end = new Date(Date.now() + DAY);
  for (const p of plan) {
    let cur = new Date(Math.floor(from.getTime() / DAY) * DAY);
    while (cur < end) {
      const next = new Date(Math.min(cur.getTime() + p.stepDays * DAY, end.getTime()));
      await db().execute(sql`CALL refresh_continuous_aggregate(${sql.raw(`'${p.view}'`)}, ${cur.toISOString()}::timestamptz, ${next.toISOString()}::timestamptz)`);
      cur = next;
    }
    log(`${p.view} refreshed from ${from.toISOString().slice(0, 10)}`);
  }
  await db().execute(sql`CALL refresh_streaks(0, NULL)`);
}
