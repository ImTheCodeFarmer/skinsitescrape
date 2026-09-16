import "server-only";
import { sql } from "@casino/db";
import { db } from "./db";

export type SiteUser = { steamId: string; name: string | null; avatar: string | null; firstLogin: string; lastLogin: string; logins: number };

/** Upsert the roster row for a Steam account that just signed in. */
export async function recordLogin(steamId: string, name: string, avatar: string | null) {
  await db().execute(sql`
    INSERT INTO site_users (steam_id, name, avatar) VALUES (${steamId}, ${name}, ${avatar})
    ON CONFLICT (steam_id) DO UPDATE SET
      name       = COALESCE(EXCLUDED.name, site_users.name),
      avatar     = COALESCE(EXCLUDED.avatar, site_users.avatar),
      last_login = now(),
      logins     = site_users.logins + 1`);
}

export async function listUsers(limit = 500): Promise<SiteUser[]> {
  const rows = (await db().execute(sql`
    SELECT steam_id, name, avatar, first_login, last_login, logins FROM site_users ORDER BY last_login DESC LIMIT ${limit}`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    steamId: String(r.steam_id),
    name: r.name == null ? null : String(r.name),
    avatar: r.avatar == null ? null : String(r.avatar),
    firstLogin: new Date(r.first_login as string).toISOString(),
    lastLogin: new Date(r.last_login as string).toISOString(),
    logins: Number(r.logins),
  }));
}
