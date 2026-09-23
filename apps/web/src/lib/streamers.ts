import "server-only";
import { sql } from "@casino/db";
import { db } from "./db";
import { STREAMER_PLATFORMS, streamerLinkUrl, type StreamerLinks, type StreamerProfile } from "./streamer-links";

/**
 * Streamer-marked players (players.is_streamer, migration 0018). The mark
 * changes no total: it tags the player's name and turns their profile into
 * a streamer profile, whose name, bio and channel links live in
 * streamer_profiles. Unmarking keeps that row, so marking again restores it.
 */
export type StreamerRow = { site: string; id: string; handle: string; avatar: string | null; name: string | null; links: StreamerLinks; lastSeen: string | null };

const toProfile = (x: Record<string, unknown>): StreamerProfile => ({
  site: String(x.site), id: String(x.external_id), name: x.name == null ? null : String(x.name), bio: x.bio == null ? null : String(x.bio),
  links: (x.links ?? {}) as StreamerLinks, updatedAt: x.updated_at ? new Date(x.updated_at as string).toISOString() : null,
});

export async function getStreamerProfile(site: string, id: string): Promise<StreamerProfile | null> {
  const r = (await db().execute(sql`SELECT site, external_id, name, bio, links, updated_at FROM streamer_profiles WHERE site = ${site} AND external_id = ${id}`)) as unknown as Record<string, unknown>[];
  return r[0] ? toProfile(r[0]) : null;
}

export async function listStreamers(): Promise<StreamerRow[]> {
  const r = (await db().execute(sql`
    SELECT p.site, p.external_id, p.display_name, p.avatar, p.last_seen, s.name, s.links
    FROM players p LEFT JOIN streamer_profiles s ON s.site = p.site AND s.external_id = p.external_id
    WHERE p.is_streamer ORDER BY p.last_seen DESC`)) as unknown as Record<string, unknown>[];
  return r.map((x) => ({
    site: String(x.site), id: String(x.external_id), handle: x.display_name == null ? String(x.external_id) : String(x.display_name),
    avatar: x.avatar == null ? null : String(x.avatar), name: x.name == null ? null : String(x.name), links: (x.links ?? {}) as StreamerLinks,
    lastSeen: x.last_seen ? new Date(x.last_seen as string).toISOString() : null,
  }));
}

/** Mark or unmark a player as a streamer. The house bots cannot be marked. */
export async function setStreamer(site: string, id: string, streamer: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = (await db().execute(sql`SELECT is_house FROM players WHERE site = ${site} AND external_id = ${id}`)) as unknown as { is_house: boolean }[];
  if (!p.length) return { ok: false, error: "Unknown player." };
  if (p[0].is_house) return { ok: false, error: "That is the house bot." };
  await db().execute(sql`UPDATE players SET is_streamer = ${streamer} WHERE site = ${site} AND external_id = ${id}`);
  return { ok: true };
}

/**
 * Save a streamer's name, bio and links. Links are given as typed (a handle
 * or a URL) and stored as URLs; empty or unusable ones are dropped, and an
 * unusable one is reported so the form can say which.
 */
export async function saveStreamerProfile(
  site: string, id: string, input: { name: string; bio: string; links: Record<string, string> },
): Promise<{ ok: true; profile: StreamerProfile } | { ok: false; error: string }> {
  const p = (await db().execute(sql`SELECT is_streamer FROM players WHERE site = ${site} AND external_id = ${id}`)) as unknown as { is_streamer: boolean }[];
  if (!p[0]?.is_streamer) return { ok: false, error: "Mark the player as a streamer first." };
  const links: StreamerLinks = {};
  for (const { key, label } of STREAMER_PLATFORMS) {
    const raw = input.links[key]?.trim() ?? "";
    if (!raw) continue;
    const url = streamerLinkUrl(key, raw);
    if (!url || url.length > 300) return { ok: false, error: `${label}: not a handle or link we can use.` };
    links[key] = url;
  }
  const name = input.name.trim().slice(0, 80) || null;
  const bio = input.bio.trim().slice(0, 500) || null;
  const r = (await db().execute(sql`
    INSERT INTO streamer_profiles (site, external_id, name, bio, links, updated_at)
    VALUES (${site}, ${id}, ${name}, ${bio}, ${JSON.stringify(links)}::jsonb, now())
    ON CONFLICT (site, external_id) DO UPDATE SET name = EXCLUDED.name, bio = EXCLUDED.bio, links = EXCLUDED.links, updated_at = now()
    RETURNING site, external_id, name, bio, links, updated_at`)) as unknown as Record<string, unknown>[];
  return { ok: true, profile: toProfile(r[0]) };
}
