/**
 * Crate Unboxing, from the site-wide ticker `games.feed.new`. Unlike the
 * other sites' tickers this one carries every opening, losses included: on
 * 2026-09-17, 207 of 272 openings were below the crate's price and the
 * sample returned 98%. The ticker has no price, so crate prices come from
 * `game.cases.list`; openings of a crate not yet in the list wait for a
 * refresh.
 *
 * Two caveats. The ticker runs about 40 minutes behind (its battle and
 * royale ids are that much older than the live rooms'), and carries no
 * timestamp, so openings are dated when received. Openings with a
 * `jackpotId` are crates opened inside a Crate Royale entry; they are
 * counted there and skipped here.
 *
 * The ticker's other games (upgrader, mines, dice, which is Beancan Blast)
 * only ever show wins, so they stay raw.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, seen, usd, type BcUser } from "./site.js";

type BcFeedItem = {
  id?: string;
  user?: BcUser;
  won?: number;
  game?: string;
  gameInfo?: { id?: string; slug?: string; name?: string; item?: string; roll?: number; items?: { name?: string; price?: number }[]; jackpotId?: string | null };
};

const prices = new Map<string, number>();
const waiting: { item: BcFeedItem; at: Date }[] = [];
let askedAt = 0;
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

export function requestPrices(ctx: AdapterContext, now = Date.now()) {
  askedAt = now;
  ctx.emit("game.cases.list", "price");
}

/** Reply to `game.cases.list`: `[{id, slug, price, ...}]`. */
export function handleCaseList(payload: unknown, ctx: AdapterContext): boolean {
  if (!Array.isArray(payload) || !payload.length || !payload.every((c) => c && typeof c === "object" && "slug" in c && "price" in c)) return false;
  for (const c of payload as { id: string; price: number }[]) prices.set(String(c.id), Number(c.price) || 0);
  ctx.log.info({ crates: prices.size }, "crate prices loaded");
  for (const w of waiting.splice(0)) settle(w.item, w.at, ctx, false);
  return true;
}

export function handleFeedItem(payload: unknown, at: Date, ctx: AdapterContext) {
  const f = payload as BcFeedItem;
  if (f?.game !== "cases" || !f.id || !f.gameInfo?.id || f.gameInfo.jackpotId) return;
  if (at.getTime() - askedAt > REFRESH_MS) requestPrices(ctx, at.getTime());
  settle(f, at, ctx, true);
}

function settle(f: BcFeedItem, at: Date, ctx: AdapterContext, mayWait: boolean) {
  const info = f.gameInfo!;
  const price = prices.get(String(info.id));
  if (price == null) {
    if (!mayWait) return;
    if (waiting.length < 2000) waiting.push({ item: f, at });
    if (at.getTime() - askedAt > RETRY_MS) requestPrices(ctx, at.getTime());
    return;
  }
  const id = seen(f.user, at, ctx);
  if (!id) return;
  const opened = Math.max(1, info.items?.length ?? 1);
  const stake = price * opened;
  const payout = Number(f.won) || 0;
  ctx.sink.bet({
    site: SITE,
    game: "cases",
    externalId: f.id!,
    roundId: f.id!,
    playerId: id,
    wageredUsd: usd(stake),
    payoutUsd: usd(payout),
    won: payout > stake,
    placedAt: at,
    settledAt: at,
    meta: { crate: info.slug ?? null, crateId: info.id, opened, item: info.item ?? null, roll: info.roll ?? null, feedDelayed: true },
  });
}
