/**
 * The Clash platform (clash.gg and its sister site cases.gg): plain
 * websockets framed as `[event, data]`, a main socket with subscribe-able
 * channels and a separate crash socket. Each site gets its own state, so
 * every handler here is a factory taking the site's `FamilySite`.
 */
import type { AdapterContext } from "../../core/adapter.js";
import type { CgUser } from "./types.js";

export type FamilySite = {
  slug: string;
  origin: string;
  /** Integer cents of the site's coin to USD. */
  usd: (cents: number) => number;
};

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Battle loans, as the platform's client computes them (cases.gg and
 * clash.gg ship the same module). A seat taken with multiplier t costs the
 * player joinPrice / t and the site lends the rest (t is at most 10, i.e.
 * 90% borrowed). In return the player keeps only (1 / t) × (1 − 0.01 × (t − 1))
 * of the seat's winnings; the battle page shows exactly that as "you get".
 * t = 1 (bots and players who did not borrow) is the plain case.
 */
export const loanStake = (priceCents: number, t: number) => (t > 1 ? priceCents / t : priceCents);
export const loanShare = (t: number) => (t > 1 ? (1 / t) * (1 - 0.01 * (t - 1)) : 1);

export const botId = (n: number) => `bot-${n}`;
export const isBot = (id: string) => id.startsWith("bot-");
export const avatarUrl = (site: FamilySite, a?: string | null) => (!a ? null : /^https?:\/\//.test(a) ? a : `${site.origin}${a.startsWith("/") ? "" : "/"}${a}`);

/** Register a real user and return the id bets are keyed by. */
export function seen(site: FamilySite, u: CgUser, at: Date, ctx: AdapterContext): string {
  const id = String(u.id);
  ctx.sink.player({ site: site.slug, externalId: id, displayName: u.name ?? null, avatar: avatarUrl(site, u.avatar), seenAt: at });
  return id;
}

/** Bots are numbered per game (1, 2, 3…), so "bot-N" is a handful of shared house identities. */
export function seenBot(site: FamilySite, n: number, at: Date, ctx: AdapterContext): string {
  const id = botId(n);
  ctx.sink.player({ site: site.slug, externalId: id, displayName: `Bot ${n}`, isHouse: true, seenAt: at });
  return id;
}
