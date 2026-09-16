import type { AdapterContext } from "../../core/adapter.js";
import type { CgUser } from "./types.js";

export const SITE = "cases";
export const ORIGIN = "https://cases.gg";

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Every amount on both sockets is integer cents of USD. */
export const usd = (cents: number) => round4((Number(cents) || 0) / 100);

/**
 * Battle loans, as the site's own client computes them (2026-09-16). A seat
 * taken with multiplier t costs the player joinPrice / t and the site lends
 * the rest (t is at most 10, i.e. 90% borrowed). In return the player keeps
 * only (1 / t) × (1 − 0.01 × (t − 1)) of the seat's winnings. t = 1 (bots
 * and players who did not borrow) is the plain case.
 */
export const loanStake = (priceCents: number, t: number) => (t > 1 ? priceCents / t : priceCents);
export const loanShare = (t: number) => (t > 1 ? (1 / t) * (1 - 0.01 * (t - 1)) : 1);

export const botId = (n: number) => `bot-${n}`;
export const isBot = (id: string) => id.startsWith("bot-");
export const avatarUrl = (a?: string | null) => (!a ? null : /^https?:\/\//.test(a) ? a : `${ORIGIN}${a.startsWith("/") ? "" : "/"}${a}`);

/** Register a real user and return the id we key bets by. */
export function seen(u: CgUser, at: Date, ctx: AdapterContext): string {
  const id = String(u.id);
  ctx.sink.player({ site: SITE, externalId: id, displayName: u.name ?? null, avatar: avatarUrl(u.avatar), seenAt: at });
  return id;
}

/** Bots are numbered per game (1, 2, 3…), so "bot-N" is a handful of shared house identities. */
export function seenBot(n: number, at: Date, ctx: AdapterContext): string {
  const id = botId(n);
  ctx.sink.player({ site: SITE, externalId: id, displayName: `Bot ${n}`, isHouse: true, seenAt: at });
  return id;
}
