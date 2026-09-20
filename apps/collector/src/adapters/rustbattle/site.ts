import type { AdapterContext } from "../../core/adapter.js";

export const SITE = "rustbattle";
export const ORIGIN = "https://rustbattle.com";

/**
 * Amounts are integer cents of coins. The site's own crypto rates
 * (`crypto:updated`) price USDT at 0.9997 coins, so a coin is a dollar.
 */
export const COIN_USD = 1;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const usd = (cents: number | string | null | undefined) => round4(((Number(cents) || 0) / 100) * COIN_USD);

export type RbUser = { uuid?: string | null; username?: string | null; avatar?: string | null; is_anonymous?: boolean; is_private?: boolean };

/** Register a real player (the site's user UUID) and return the id bets are keyed by. */
export function seen(u: RbUser | null | undefined, at: Date, ctx: AdapterContext): string | null {
  if (!u?.uuid) return null;
  const anon = u.is_anonymous === true;
  ctx.sink.player({ site: SITE, externalId: u.uuid, displayName: anon ? "Anonymous" : u.username ?? null, avatar: anon ? null : u.avatar ?? null, seenAt: at });
  return u.uuid;
}

/** Battle bots carry a "bot identity" (a named Rust NPC); each identity is one house player. */
export function seenBot(identity: { id?: number | null; name?: string | null; thumbnail?: string | null } | null | undefined, at: Date, ctx: AdapterContext): string {
  const id = `bot-${identity?.id ?? 0}`;
  ctx.sink.player({ site: SITE, externalId: id, displayName: identity?.name ?? "Bot", avatar: identity?.thumbnail ?? null, isHouse: true, seenAt: at });
  return id;
}
