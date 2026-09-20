"use server";

import { revalidatePath } from "next/cache";
import { SteamEnricher } from "@casino/db/steam-enrich";
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
