/**
 * Crash. `crash:index` carries the whole game on every state change
 * (`status` waiting → in_progress → finished) with `crashUsers`, one entry
 * per bet; `crash:multiplier` ticks about four times a second and is not
 * stored. `multiplier` is in hundredths (440 = 4.40x).
 *
 * The per-bet fields have not been seen live yet (no one played crash while
 * the feed was read on 2026-09-19 and 2026-09-20), so the handler reads the
 * usual names defensively: the stake from `amount`, a cash-out from any of
 * `cashout_multiplier`, `cashout`, `multiplier` or `payout_multiplier`
 * (hundredths), or a payout given outright in `payout` / `won` / `profit`.
 * Anything unrecognised is kept in meta; the raw rows allow a reparse once
 * the shape is confirmed.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type RbUser, SITE, seen, usd } from "./site.js";

type RbCrashUser = {
  id?: number | string;
  user_uuid?: string | null;
  user?: RbUser | null;
  amount?: number | string;
  status?: string;
  cashout_multiplier?: number | string | null;
  cashout?: number | string | null;
  multiplier?: number | string | null;
  payout_multiplier?: number | string | null;
  auto_cashout?: number | string | null;
  payout?: number | string | null;
  won?: number | string | null;
  profit?: number | string | null;
};

export type RbCrashGame = { uuid: string; status?: string; multiplier?: number | null; amount?: number; created_at?: string; started_at?: string; updated_at?: string; crashUsers?: RbCrashUser[] };

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export function crash() {
  const settled = new Set<string>();
  let warned = false;

  function onIndex(p: { game?: RbCrashGame } | RbCrashGame, receivedAt: Date, ctx: AdapterContext) {
    const g = (p as { game?: RbCrashGame }).game ?? (p as RbCrashGame);
    if (!g?.uuid || g.status !== "finished" || settled.has(g.uuid)) return;
    const users = g.crashUsers ?? [];
    if (!users.length) return;
    settled.add(g.uuid);
    if (settled.size > 5000) settled.delete(settled.values().next().value!);
    const crashed = num(g.multiplier);
    const placedAt = g.created_at ? new Date(g.created_at) : receivedAt;
    const settledAt = g.updated_at ? new Date(g.updated_at) : receivedAt;
    for (const u of users) {
      const pid = seen(u.user ?? { uuid: u.user_uuid }, receivedAt, ctx);
      if (!pid) continue;
      const stake = usd(u.amount);
      const cashout = num(u.cashout_multiplier) ?? num(u.cashout) ?? num(u.payout_multiplier) ?? num(u.multiplier);
      const outright = num(u.payout) ?? num(u.won);
      let payout: number;
      if (outright != null) payout = usd(outright);
      else if (cashout && cashout > 0 && (crashed == null || cashout <= crashed)) payout = usd((Number(u.amount) || 0) * (cashout / 100));
      else if (num(u.profit) != null) payout = stake + usd(num(u.profit)!);
      else payout = 0;
      if (!warned && outright == null && cashout == null && num(u.profit) == null) {
        warned = true;
        ctx.log.warn({ keys: Object.keys(u) }, "crash bet without a recognised cash-out field; settled as a loss, check the raw row");
      }
      ctx.sink.bet({
        site: SITE,
        game: "crash",
        externalId: `${g.uuid}:${u.id ?? pid}`,
        roundId: g.uuid,
        playerId: pid,
        wageredUsd: stake,
        payoutUsd: payout,
        won: payout > stake ? true : payout < stake ? false : null,
        placedAt,
        settledAt,
        meta: { crashedAt: crashed == null ? null : crashed / 100, cashout: cashout == null ? null : cashout / 100, status: u.status, raw: u },
      });
    }
  }

  return { onIndex };
}
