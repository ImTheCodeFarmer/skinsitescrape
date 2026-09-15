/**
 * CSGOGem battles: the legacy scraper stored a users row per real participant
 * with what they paid and what they won, so bets are direct. Amounts are the
 * site's integer units (see config.ts).
 */
import { LEGACY_META, date, groupBy, moneyFor } from "../config.js";
import { extId, profiles } from "../profiles.js";
import type { Row, Source } from "../types.js";

const SITE = "csgogem";
const usd = moneyFor(SITE);

export const csgogemBattles: Source = {
  name: "csgogem-battles",
  site: SITE,
  table: "csgogem_battles",
  where: "internal_id IS NOT NULL",
  cutoffs: { bets: { table: "bets", col: "placed_at", game: "battles" } },
  async handle(rows, ctx) {
    const ids = rows.map((r) => String(r.id));
    const users = (await ctx.legacy.unsafe(
      `SELECT csgogem_battles_id AS bid, csgogem_users_id AS uid, amount, amount_paid, amount_won
       FROM csgogem_battles_users WHERE csgogem_battles_id = ANY($1::int[]) AND csgogem_users_id IS NOT NULL`,
      [ids],
    )) as unknown as Row[];
    const byBattle = groupBy(users, "bid");
    const profile = await profiles(ctx, "csgogem_users", "id, internal_id AS ext, username AS name, avatar");
    const cutoff = ctx.cutoffs.bets;

    for (const b of rows) {
      const placedAt = date(b.created_at)!;
      if (cutoff && placedAt >= cutoff) {
        ctx.stats.skipped++;
        continue;
      }
      const players = byBattle.get(String(b.id)) ?? [];
      if (!players.length) {
        ctx.stats.skipped++;
        continue;
      }
      const roundId = String(b.internal_id);
      const settledAt = date(b.updated_at) ?? placedAt;
      for (const p of players) {
        const prof = profile.get(String(p.uid));
        const externalId = extId(profile, p.uid);
        ctx.sink.player({ site: SITE, externalId, displayName: prof?.name, avatar: prof?.avatar, seenAt: placedAt });
        const wagered = usd(p.amount_paid ?? p.amount);
        const payout = usd(p.amount_won);
        ctx.sink.bet({
          site: SITE,
          game: "battles",
          externalId: `${roundId}:${externalId}`,
          roundId,
          playerId: externalId,
          wageredUsd: wagered,
          payoutUsd: payout,
          won: payout > 0,
          placedAt,
          settledAt,
          meta: LEGACY_META,
        });
      }
      ctx.stats.emitted++;
    }
  },
};

