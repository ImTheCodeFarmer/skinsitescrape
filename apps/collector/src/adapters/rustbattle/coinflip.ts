/**
 * Coinflip. `coinflip:store` announces a lobby and `coinflip:update`
 * carries `{game}` on every change. The client reads `game.users[]` (each
 * with a `side`, heads or tails, and their `items`, priced in cents),
 * `game.amount` and `game.winning_side` once the flip is done.
 *
 * No flip was seen live while the feed was read (2026-09-19 and
 * 2026-09-20), so the handler is defensive: a user's stake is their items'
 * value (or `amount` when they carry one), the winner is the user on
 * `winning_side`, and the pot is assumed to go to the winner in full
 * (`meta.payoutAssumed`) until a real round shows the rake. Raw rows allow a
 * reparse once the shape is confirmed.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type RbUser, SITE, seen, seenBot, usd } from "./site.js";

type RbFlipUser = {
  id?: number | string;
  user_uuid?: string | null;
  user?: RbUser | null;
  side?: string | null;
  bot?: 0 | 1 | boolean;
  botIdentity?: { id?: number | null; name?: string | null; thumbnail?: string | null } | null;
  amount?: number | string | null;
  items?: { price?: number | string; coins?: number | string }[];
  skins?: { price?: number | string; coins?: number | string }[];
  won?: number | string | null;
};

export type RbFlip = {
  uuid: string;
  status?: string;
  currency?: string;
  amount?: number | string;
  winning_side?: string | null;
  winner_uuid?: string | null;
  created_at?: string;
  updated_at?: string;
  users?: RbFlipUser[];
};

const DONE = new Set(["ended", "finished", "completed", "done"]);

export function coinflip() {
  const settled = new Set<string>();

  function onUpdate(p: { game?: RbFlip } | RbFlip, receivedAt: Date, ctx: AdapterContext) {
    const g = (p as { game?: RbFlip }).game ?? (p as RbFlip);
    if (!g?.uuid || settled.has(g.uuid)) return;
    if (!g.winning_side && !DONE.has(String(g.status))) return;
    if (g.currency && g.currency !== "coins") return;
    const users = g.users ?? [];
    if (users.length < 2) return;
    settled.add(g.uuid);
    if (settled.size > 5000) settled.delete(settled.values().next().value!);
    const stakeOf = (u: RbFlipUser) => {
      const items = u.items ?? u.skins ?? [];
      const fromItems = items.reduce((a, it) => a + (Number(it.coins ?? it.price) || 0), 0);
      return usd(fromItems || u.amount || g.amount);
    };
    const pot = users.reduce((a, u) => a + stakeOf(u), 0);
    const placedAt = g.created_at ? new Date(g.created_at) : receivedAt;
    const settledAt = g.updated_at ? new Date(g.updated_at) : receivedAt;
    for (const u of users) {
      const house = u.bot === 1 || u.bot === true;
      const pid = house ? seenBot(u.botIdentity, receivedAt, ctx) : seen(u.user ?? { uuid: u.user_uuid }, receivedAt, ctx);
      if (!pid) continue;
      const stake = stakeOf(u);
      const won = g.winner_uuid ? g.winner_uuid === (u.user?.uuid ?? u.user_uuid) : g.winning_side != null ? u.side === g.winning_side : null;
      const outright = u.won == null ? null : usd(u.won);
      const payout = outright ?? (won ? pot : 0);
      ctx.sink.bet({
        site: SITE,
        game: "coinflip",
        externalId: `${g.uuid}:${u.id ?? pid}`,
        roundId: g.uuid,
        playerId: pid,
        isHouse: house,
        wageredUsd: stake,
        payoutUsd: payout,
        won,
        placedAt,
        settledAt,
        meta: { side: u.side, winningSide: g.winning_side, potUsd: pot, payoutAssumed: outright == null || undefined },
      });
    }
  }

  return { onUpdate };
}
