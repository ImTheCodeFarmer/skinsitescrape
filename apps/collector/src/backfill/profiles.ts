/**
 * Legacy user tables are small (the largest, clash_users, is ~50 MB) but the
 * legacy disk is slow at random reads: a batch's few hundred profile lookups
 * by primary key took 10-20 s. One sequential read of the whole table per run
 * is far cheaper, so profiles are loaded once and kept in memory.
 */
import type { Row, SourceCtx } from "./types.js";

export type Profile = { ext: string; name: string | null; avatar: string | null };

const cache = new Map<string, Map<string, Profile>>();

/**
 * @param table   legacy users table
 * @param cols    SQL select list yielding id, ext (site-side id or null), name, avatar
 */
export async function profiles(ctx: SourceCtx, table: string, cols: string): Promise<Map<string, Profile>> {
  const hit = cache.get(table);
  if (hit) return hit;
  const t = Date.now();
  const rows = (await ctx.legacy.unsafe(`SELECT ${cols} FROM ${table}`)) as unknown as Row[];
  const m = new Map<string, Profile>();
  for (const r of rows) {
    m.set(String(r.id), { ext: r.ext == null || r.ext === "" ? String(r.id) : String(r.ext), name: r.name == null || r.name === "" ? null : String(r.name), avatar: r.avatar == null || r.avatar === "" ? null : String(r.avatar) });
  }
  cache.set(table, m);
  ctx.log.info({ table, rows: m.size, ms: Date.now() - t }, "loaded profiles");
  return m;
}

/** Site-side id for a legacy user id; falls back to a stable placeholder when the profile row is missing. */
export const extId = (m: Map<string, Profile>, legacyId: unknown) => m.get(String(legacyId))?.ext ?? `legacy:${legacyId}`;
