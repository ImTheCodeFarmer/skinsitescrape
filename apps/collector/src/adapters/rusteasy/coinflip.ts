/**
 * Coinflip, room "coinflip". `newCoinflipGame` opens a game with the
 * creator's side ("ct" or "t") and amount; `coinflipGameUpdate` moves it
 * along: status 2 a second player joined (the house bot "Tunnel Dweller",
 * steamid64 "0", when called), 3 rolling, 4 finished with `winner_side`,
 * 5 cancelled, 1 back to open. The winner takes both stakes less the site's
 * fee (7% per the FAQ, 5% with the promo tag; `fee` on the event when the
 * site sends it, else estimated).
 */
import type { AdapterContext } from "../../core/adapter.js";
import { COINFLIP_FEE, SITE, isHouse, parse, seen, usd } from "./site.js";
import type { ReCoinflipNew, ReCoinflipUpdate } from "./types.js";

type Game = { createdAt: Date; first: { id: string; side: string; amount: number }; second: { id: string; side: string; amount: number } | null };
const games = new Map<number, Game>();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function handleCoinflipNew(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const g = parse<ReCoinflipNew>(payload);
  if (!g?.coinflip_id) return;
  for (const [k, v] of games) if (receivedAt.getTime() - v.createdAt.getTime() > MAX_AGE_MS) games.delete(k);
  const id = seen({ steamid64: g.user_steamid64, username: g.user_username, avatar: g.user_avatar }, receivedAt, ctx);
  if (!id) return;
  games.set(g.coinflip_id, { createdAt: g.created_at ? new Date(g.created_at) : receivedAt, first: { id, side: String(g.side), amount: usd(g.amount) }, second: null });
}

export function handleCoinflipUpdate(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const u = parse<ReCoinflipUpdate>(payload);
  const g = u?.game_id ? games.get(u.game_id) : undefined;
  if (!u || !g) return;
  switch (Number(u.status)) {
    case 1:
      g.second = null;
      return;
    case 2: {
      const id = seen({ steamid64: u.user_steamid64, username: u.username, avatar: u.avatar }, receivedAt, ctx);
      if (id) g.second = { id, side: String(u.side), amount: usd(u.second_amount ?? u.amount ?? g.first.amount) };
      return;
    }
    case 5:
      games.delete(u.game_id);
      return;
    case 4: {
      games.delete(u.game_id);
      if (!g.second || !u.winner_side) return;
      const pot = g.first.amount + g.second.amount;
      const fee = typeof u.fee === "number" ? u.fee / 100 : COINFLIP_FEE;
      const roundId = String(u.game_id);
      const settledAt = u.finish_date ? new Date(u.finish_date) : receivedAt;
      for (const p of [g.first, g.second]) {
        const won = p.side === u.winner_side;
        ctx.sink.bet({
          site: SITE,
          game: "coinflip",
          externalId: `${roundId}:${p.id}`,
          roundId,
          playerId: p.id,
          isHouse: isHouse(p.id),
          wageredUsd: p.amount,
          payoutUsd: won ? usd(pot * (1 - fee)) : 0,
          won,
          placedAt: g.createdAt,
          settledAt,
          meta: { side: p.side, winningSide: u.winner_side, potUsd: usd(pot), feeRate: fee, taxEstimated: typeof u.fee !== "number", winTicket: u.winTicket ?? null },
        });
      }
    }
  }
}
