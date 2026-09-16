import type { AdapterContext } from "../../core/adapter.js";

export const SITE = "rusteasy";
export const ORIGIN = "https://www.rusteasy.com";

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Amounts are already USD; this only normalises strings and noise. */
export const usd = (v: number | string | null | undefined) => round4(Number(v) || 0);

/** Several events arrive as a JSON string instead of an object. */
export function parse<T>(p: unknown): T | null {
  if (typeof p === "string") {
    try {
      return JSON.parse(p) as T;
    } catch {
      return null;
    }
  }
  return (p as T) ?? null;
}

/**
 * The house plays as "Tunnel Dweller" (steamid64 "0") in coinflip, jackpot
 * and champion; battle seats hold the literal "bot". All become one house
 * player per game so the rollups can tell them apart from real players.
 */
export const HOUSE = "0";
export const isHouse = (id: string) => id === HOUSE || id.startsWith("bot");
export const avatarUrl = (a?: string | null) => (!a ? null : /^https?:\/\//.test(a) ? a : `${ORIGIN}${a.startsWith("/") ? "" : "/"}${a}`);

export function seen(u: { steamid64?: string | null; username?: string | null; avatar?: string | null }, at: Date, ctx: AdapterContext): string | null {
  const id = u?.steamid64 != null ? String(u.steamid64) : null;
  if (!id) return null;
  ctx.sink.player({ site: SITE, externalId: id, displayName: u.username ?? null, avatar: avatarUrl(u.avatar), isHouse: isHouse(id), seenAt: at });
  return id;
}

export function seenBot(id: string, name: string | null, at: Date, ctx: AdapterContext): string {
  ctx.sink.player({ site: SITE, externalId: id, displayName: name, isHouse: true, seenAt: at });
  return id;
}

/**
 * Fees from the site's FAQ (2026-09-16): coinflip and jackpot 7% (5% for
 * players with "#RustisEasy" in their Steam name), champion 10%. The feed
 * never states the fee actually taken, so bets carry `taxEstimated`.
 */
export const COINFLIP_FEE = 0.07;
export const JACKPOT_FEE = 0.07;
export const CHAMPION_FEE = 0.1;
