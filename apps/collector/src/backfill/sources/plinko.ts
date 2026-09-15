/** Clash.gg / RustClash plinko: one row per drop with the multiplier it landed on. */
import { LEGACY_META, date, moneyFor, num, round4 } from "../config.js";
import { profiles } from "../profiles.js";
import type { Source } from "../types.js";

type Cfg = { name: string; site: string; bets: string; userCol: string; profiles: string };

function make(cfg: Cfg): Source {
  const usd = moneyFor(cfg.site);
  return {
    name: cfg.name,
    site: cfg.site,
    table: cfg.bets,
    where: "currency = 'REAL'",
    cutoffs: { bets: { table: "bets", col: "placed_at", game: "plinko" } },
    async handle(rows, ctx) {
      const profile = await profiles(ctx, cfg.profiles, "id, NULL AS ext, display_name AS name, avatar");
      const cutoff = ctx.cutoffs.bets;
      for (const b of rows) {
        const placedAt = date(b.created_at)!;
        if (cutoff && placedAt >= cutoff) {
          ctx.stats.skipped++;
          continue;
        }
        const uid = String(b[cfg.userCol]);
        const prof = profile.get(uid);
        ctx.sink.player({ site: cfg.site, externalId: uid, displayName: prof?.name, avatar: prof?.avatar, seenAt: placedAt });
        const wagered = usd(b.bet_amount);
        const payout = round4(wagered * num(b.multiplier));
        ctx.sink.bet({
          site: cfg.site,
          game: "plinko",
          externalId: String(b.id),
          roundId: null,
          playerId: uid,
          wageredUsd: wagered,
          payoutUsd: payout,
          won: payout > wagered,
          placedAt,
          settledAt: placedAt,
          meta: { ...LEGACY_META, multiplier: num(b.multiplier), rows: num(b.rows) },
        });
        ctx.stats.emitted++;
      }
    },
  };
}

export const clashPlinko = make({ name: "clash-plinko", site: "clash", bets: "clash_plinko_bets", userCol: "clash_user_id", profiles: "clash_users" });
export const rustclashPlinko = make({ name: "rustclash-plinko", site: "rustclash", bets: "rustclash_plinko_bets", userCol: "rust_clash_user_id", profiles: "rust_clash_users" });
