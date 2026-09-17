import type { AdapterContext } from "../../core/adapter.js";

export const SITE = "banditcamp";
export const ORIGIN = "https://bandit.camp";

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Amounts are scrap in hundredths: 100 = 1.00 scrap = $1 (the same scale the legacy backfill uses). */
export const usd = (v: number | string | null | undefined) => round4((Number(v) || 0) / 100);

/** The site's own bots ("bandits") sit in battles, royale and spinners as "banditcamp-<n|colour>". */
export const isBot = (id: string, flag?: boolean) => flag === true || id.startsWith("banditcamp-");

export type BcUser = { steamid?: string | null; name?: string | null; avatar?: string | null; bot?: boolean };

export function seen(u: BcUser | null | undefined, at: Date, ctx: AdapterContext): string | null {
  const id = u?.steamid != null ? String(u.steamid) : null;
  if (!id) return null;
  ctx.sink.player({ site: SITE, externalId: id, displayName: u!.name ?? null, avatar: u!.avatar ?? null, isHouse: isBot(id, u!.bot), seenAt: at });
  return id;
}

/** Mongo ObjectId → its creation time, for rounds whose events carry no timestamp. */
export const objectIdTime = (id: string, fallback: Date) => {
  const s = parseInt(String(id).slice(0, 8), 16);
  return Number.isFinite(s) && s > 0 ? new Date(s * 1000) : fallback;
};
