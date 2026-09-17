import type { AdapterContext } from "../../core/adapter.js";

export const SITE = "rustyloot";
export const ORIGIN = "https://rustyloot.gg";

/**
 * Amounts are thousandths of a coin (the client shows `amount / 1e3`). The
 * site sells coins at 1.55 to the dollar: its deposit forms convert with
 * `usd × 1.55` and back with `coins / 1.55` (one Polish payment route uses
 * 1.5). So a coin is counted as $1 / 1.55, about $0.645.
 */
export const COINS_PER_USD = 1.55;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const usd = (v: number | string | null | undefined) => round4((Number(v) || 0) / 1000 / COINS_PER_USD);

export function seen(u: { id?: string | number | null; name?: string | null; avatar?: string | null }, at: Date, ctx: AdapterContext): string | null {
  if (u?.id == null || String(u.id) === "0") return null;
  const id = String(u.id);
  ctx.sink.player({ site: SITE, externalId: id, displayName: u.name ?? null, avatar: u.avatar || null, seenAt: at });
  return id;
}

/** The house fills empty seats with bots that carry no id: one house player per game and seat. */
export function seenBot(game: string, index: number | string, at: Date, ctx: AdapterContext): string {
  const id = `bot-${game}-${index}`;
  ctx.sink.player({ site: SITE, externalId: id, displayName: "RustyBot", isHouse: true, seenAt: at });
  return id;
}
