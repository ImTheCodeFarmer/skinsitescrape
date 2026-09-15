/**
 * Rustyloot battles. The battles table's status column never left "open", so
 * completion is detected by the presence of winners rows (bots included). A
 * real player's stake is join_price less the borrow_percent the site fronted;
 * a winners row for the same seat index carries the payout.
 *
 * The walk goes over rustyloot_case_battle_users (one row per real seat) in
 * primary-key order, which on the legacy disk is close to sequential. Battles
 * are fetched by primary key. Winners have no index on case_battle_id, so
 * that table is read in windows of WINDOW battle ids (one 150 MB sequential
 * scan per window, about ten for the whole history) and joined in memory.
 */
import { LEGACY_META, date, groupBy, moneyFor, num, round4, uniq } from "../config.js";
import { extId, profiles } from "../profiles.js";
import type { Row, Source, SourceCtx } from "../types.js";

const SITE = "rustyloot";
const usd = moneyFor(SITE);
const WINDOW = Number(process.env.BACKFILL_RUSTYLOOT_WINDOW ?? 100_000);

type Window = { from: number; to: number; winners: Map<string, Row[]> };
let win: Window | null = null;

async function winnersFor(ctx: SourceCtx, minBattle: number, maxBattle: number): Promise<Map<string, Row[]>> {
  if (win && minBattle >= win.from && maxBattle < win.to) return win.winners;
  const from = minBattle;
  const to = Math.max(minBattle + WINDOW, maxBattle + 1);
  const t = Date.now();
  const rows = (await ctx.legacy.unsafe(
    `SELECT case_battle_id AS bid, index, user_id, amount_won, created_at FROM rustyloot_case_battle_winners
     WHERE case_battle_id >= $1 AND case_battle_id < $2`,
    [from, to],
  )) as unknown as Row[];
  win = { from, to, winners: groupBy(rows, "bid") };
  ctx.log.info({ from, to, winners: rows.length, ms: Date.now() - t }, "loaded winners window");
  return win.winners;
}

export const rustylootBattles: Source = {
  name: "rustyloot-battles",
  site: SITE,
  table: "rustyloot_case_battle_users",
  where: "user_id IS NOT NULL AND case_battle_id IS NOT NULL",
  cutoffs: { bets: { table: "bets", col: "placed_at", game: "battles" } },
  async handle(rows, ctx) {
    const bids = uniq(rows.map((r) => Number(r.case_battle_id)));
    const [battles, winners, profile] = await Promise.all([
      ctx.legacy.unsafe(`SELECT id, internal_id, join_price, created_at, updated_at FROM rustyloot_case_battles WHERE id = ANY($1::int[])`, [bids]) as unknown as Promise<Row[]>,
      winnersFor(ctx, Math.min(...bids), Math.max(...bids)),
      profiles(ctx, "rustyloot_users", "id, internal_id AS ext, name, avatar"),
    ]);
    const battle = new Map(battles.map((b) => [String(b.id), b]));
    const cutoff = ctx.cutoffs.bets;

    for (const seat of rows) {
      const b = battle.get(String(seat.case_battle_id));
      const ws = winners.get(String(seat.case_battle_id));
      if (!b || !b.internal_id || !ws?.length) {
        ctx.stats.skipped++; // unknown battle or never finished
        continue;
      }
      const placedAt = date(seat.created_at) ?? date(b.created_at)!;
      if (cutoff && placedAt >= cutoff) {
        ctx.stats.skipped++;
        continue;
      }
      const prof = profile.get(String(seat.user_id));
      const externalId = extId(profile, seat.user_id);
      ctx.sink.player({ site: SITE, externalId, displayName: prof?.name, avatar: prof?.avatar, seenAt: placedAt });
      const w = ws.find((x) => num(x.index) === num(seat.index));
      const roundId = String(b.internal_id);
      const borrow = num(seat.borrow_percent) / 100;
      ctx.sink.bet({
        site: SITE,
        game: "battles",
        externalId: `${roundId}:${externalId}:${num(seat.index)}`,
        roundId,
        playerId: externalId,
        wageredUsd: round4(usd(b.join_price) * (1 - borrow)),
        payoutUsd: w ? usd(w.amount_won) : 0,
        won: !!w,
        placedAt,
        settledAt: date(ws[0].created_at) ?? date(b.updated_at) ?? placedAt,
        meta: borrow ? { ...LEGACY_META, borrowPercent: num(seat.borrow_percent) } : LEGACY_META,
      });
      ctx.stats.emitted++;
    }
  },
};
