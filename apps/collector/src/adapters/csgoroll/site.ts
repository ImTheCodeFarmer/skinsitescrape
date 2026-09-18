import type { AdapterContext } from "../../core/adapter.js";

export const SITE = "csgoroll";
export const ORIGIN = "https://www.csgoroll.com";

/**
 * Amounts on the wire are decimal coins (`currency: "TKN"`). The site's own
 * `ExchangeRateList` query (source TKN) gave USD 0.70 on 2026-09-18; queries
 * are refused on the socket for guests, so the rate is a constant here.
 * Stablecoin wallets count 1:1; anything else is converted as coins and
 * flagged in meta by the caller.
 */
export const USD_PER_COIN = 0.7;
const USD_PER: Record<string, number> = { TKN: USD_PER_COIN, USD: 1, USDT: 1, USDTE: 1, USDC: 1, DAI: 1 };
export const knownCurrency = (c: string | null | undefined) => c != null && c in USD_PER;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const usd = (v: number | string | null | undefined, currency: string | null | undefined = "TKN") =>
  round4((Number(v) || 0) * (USD_PER[currency ?? "TKN"] ?? USD_PER_COIN));

/**
 * Ids are Relay global ids, base64 of `Type:number` ("VXNlcjo2NjgyNTQ3" is
 * "User:6682547"). The site uses them verbatim in its URLs and chat
 * mentions, so they are stored as they come.
 */

export type RollUser = { id?: string | null; name?: string | null; displayName?: string | null; avatar?: string | null };

export function seen(u: RollUser | null | undefined, at: Date, ctx: AdapterContext, isHouse = false): string | null {
  if (u?.id == null || u.id === "") return null;
  const id = String(u.id);
  ctx.sink.player({ site: SITE, externalId: id, displayName: u?.displayName ?? u?.name ?? null, avatar: u?.avatar || null, isHouse, seenAt: at });
  return id;
}
