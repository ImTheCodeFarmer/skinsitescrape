/**
 * Clash.gg / RustClash "double" roulette. The legacy scraper stored each bet's
 * colour and amount and each game's outcome (0-14) but never the payout, so
 * payouts are reconstructed from the wheel layout. That layout could not be
 * confirmed from the site (it is behind Cloudflare), so this source is opt-in
 * until BACKFILL_ROULETTE_WHEEL is verified. Format: 15 comma-separated
 * colours for outcomes 0..14, e.g. "GREEN,RED,BLACK,...". Multipliers follow
 * the site's advertised odds: red/black 2x, bait 7x, green 14x.
 */
import { LEGACY_META, date, moneyFor, num, round4, uniq } from "../config.js";
import { profiles } from "../profiles.js";
import type { Row, Source } from "../types.js";

const MULTIPLIER: Record<string, number> = { RED: 2, BLACK: 2, BAIT: 7, GREEN: 14 };
// Working assumption: green on 0, two bait tiles, red and black alternating on the rest.
const DEFAULT_WHEEL = "GREEN,RED,BLACK,RED,BLACK,RED,BLACK,BAIT,RED,BLACK,RED,BLACK,RED,BLACK,BAIT";

export function wheel(): string[] {
  const w = (process.env.BACKFILL_ROULETTE_WHEEL ?? DEFAULT_WHEEL).split(",").map((s) => s.trim().toUpperCase());
  if (w.length !== 15 || w.some((c) => !(c in MULTIPLIER))) throw new Error("BACKFILL_ROULETTE_WHEEL must list 15 colours out of RED, BLACK, BAIT, GREEN");
  return w;
}

type Cfg = { name: string; site: string; bets: string; games: string; gameCol: string; userCol: string; profiles: string };

function make(cfg: Cfg): Source {
  const usd = moneyFor(cfg.site);
  return {
    name: cfg.name,
    site: cfg.site,
    table: cfg.bets,
    where: "currency = 'REAL'",
    optIn: true,
    note: "payouts reconstructed from BACKFILL_ROULETTE_WHEEL; verify the wheel layout first",
    cutoffs: { bets: { table: "bets", col: "placed_at", game: "roulette" } },
    async handle(rows, ctx) {
      const layout = wheel();
      const gids = uniq(rows.map((r) => String(r[cfg.gameCol])));
      const games = (await ctx.legacy.unsafe(`SELECT internal_id, outcome, updated_at FROM ${cfg.games} WHERE internal_id = ANY($1::int[]) AND outcome IS NOT NULL`, [gids])) as unknown as Row[];
      const game = new Map(games.map((g) => [String(g.internal_id), g]));
      const profile = await profiles(ctx, cfg.profiles, "id, NULL AS ext, display_name AS name, avatar");
      const cutoff = ctx.cutoffs.bets;
      for (const b of rows) {
        const g = game.get(String(b[cfg.gameCol]));
        const placedAt = date(b.created_at)!;
        if (!g || (cutoff && placedAt >= cutoff)) {
          ctx.stats.skipped++;
          continue;
        }
        const uid = String(b[cfg.userCol]);
        const prof = profile.get(uid);
        ctx.sink.player({ site: cfg.site, externalId: uid, displayName: prof?.name, avatar: prof?.avatar, seenAt: placedAt });
        const option = String(b.option).toUpperCase();
        const won = layout[num(g.outcome)] === option;
        const wagered = usd(b.amount);
        ctx.sink.bet({
          site: cfg.site,
          game: "roulette",
          externalId: `${g.internal_id}:${b.id}`,
          roundId: String(g.internal_id),
          playerId: uid,
          wageredUsd: wagered,
          payoutUsd: won ? round4(wagered * (MULTIPLIER[option] ?? 0)) : 0,
          won,
          placedAt,
          settledAt: date(g.updated_at) ?? placedAt,
          meta: { ...LEGACY_META, option, outcome: num(g.outcome) },
        });
        ctx.stats.emitted++;
      }
    },
  };
}

export const clashRoulette = make({
  name: "clash-roulette",
  site: "clash",
  bets: "clash_roulette_bets",
  games: "clash_roulette_games",
  gameCol: "clash_roulette_internal_id",
  userCol: "clash_user_id",
  profiles: "clash_users",
});

export const rustclashRoulette = make({
  name: "rustclash-roulette",
  site: "rustclash",
  bets: "rustclash_roulette_bets",
  games: "rustclash_roulette_games",
  gameCol: "rustclash_roulette_internal_id",
  userCol: "rust_clash_user_id",
  profiles: "rust_clash_users",
});
