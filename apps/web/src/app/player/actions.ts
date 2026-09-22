"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { SteamEnricher } from "@casino/db/steam-enrich";
import { isAdminPlayer, refreshAggregatesFrom, setAdminPlayer } from "@/lib/admin-players";
import { getSession, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export type FetchSteamState = { ok?: boolean; error?: string } | null;

/** Fetch a Steam profile right now for the "Fetch Steam data" button. Same code and budget as the collector's background job. */
export async function fetchSteamAction(site: string, id: string, steamId: string): Promise<FetchSteamState> {
  const s = await getSession();
  if (!isAdmin(s)) return { ok: false, error: "Not allowed" };
  try {
    const r = await new SteamEnricher(db(), console).fetchOne(steamId);
    revalidatePath(`/player/${site}/${encodeURIComponent(id)}`);
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Steam did not answer" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export type AdminPlayerState = { ok: true; admin: boolean; message?: string } | { ok: false; error: string };

/** Whether a player is admin-marked, for the right-click menu's label. */
export async function adminPlayerStateAction(site: string, id: string): Promise<AdminPlayerState> {
  const s = await getSession();
  if (!isAdmin(s)) return { ok: false, error: "Not allowed" };
  return { ok: true, admin: await isAdminPlayer(site, id) };
}

/**
 * Mark or unmark a player as an admin of their site. Their bets stay in
 * the log but stop (or start) counting toward every total. The aggregate
 * refresh over the player's history runs after the response is sent.
 */
export async function setAdminPlayerAction(site: string, id: string, admin: boolean): Promise<AdminPlayerState> {
  const s = await getSession();
  if (!isAdmin(s)) return { ok: false, error: "Not allowed" };
  try {
    const r = await setAdminPlayer(site, id, admin);
    if (!r.ok) return r;
    if (r.from) {
      const from = r.from;
      after(() => refreshAggregatesFrom(from, (m) => console.log(`[admin-players] ${site}/${id}: ${m}`)).catch((e) => console.error("[admin-players] aggregate refresh failed", e)));
    }
    revalidatePath("/", "layout");
    const n = r.bets === 1 ? "1 bet" : `${r.bets.toLocaleString("en-US")} bets`;
    return { ok: true, admin, message: admin ? `Marked as admin. ${n} removed from the totals.` : `Admin mark removed. ${n} count again.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
