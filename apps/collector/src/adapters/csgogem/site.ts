import type { AdapterContext } from "../../core/adapter.js";
import type { GemFxRates, GemUser } from "./types.js";

export const SITE = "csgogem";

/**
 * USD per coin. The site's `app.onFxRateUpdate` (and `config.coins`) put the
 * coin at $0.60 on 2026-09-15; the feed updates it live. Amounts on the wire
 * are cents of a coin.
 */
let coinUsd = 0.6;
export const setFxRates = (fx: GemFxRates) => {
  const r = fx?.USD?.rate;
  if (typeof r === "number" && r > 0 && r < 100) coinUsd = r;
};
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const usd = (cents: number) => round4(((Number(cents) || 0) / 100) * coinUsd);

const IMAGES = "https://imagedelivery.net/o4t4FylJPoWj4ZRxwBuX2A";
export const isBot = (userId: string) => userId.startsWith("bot-");
export const avatarUrl = (a?: string | null) => (!a ? null : /^https?:\/\//.test(a) ? a : `${IMAGES}/${a}/public`);

export function seen(u: GemUser | undefined, userId: string, at: Date, ctx: AdapterContext) {
  ctx.sink.player({ site: SITE, externalId: userId, displayName: u?.username ?? null, avatar: avatarUrl(u?.avatar), isHouse: isBot(userId), seenAt: at });
}
