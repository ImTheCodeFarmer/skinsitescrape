import { sql, type Db } from "@casino/db";
import type { Logger } from "pino";

const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The continuous-aggregate policies only look back a few days, so history
 * inserted by the backfill never reaches bets_hourly / bets_daily /
 * player_daily on its own. Refresh them in windows, oldest first, with a
 * pause between calls so the database keeps serving the dashboard. Each
 * window only touches its own chunks, so an interrupted refresh can simply
 * be run again.
 */
export async function refreshAggregates(db: Db, log: Logger, opts: { pauseMs: number; from?: Date | null }) {
  let from = opts.from ?? null;
  if (!from) {
    const rows = (await db.execute(sql`SELECT min(placed_at) AS t FROM bets WHERE meta ? 'legacy'`)) as unknown as { t: string | null }[];
    from = rows[0]?.t ? new Date(rows[0].t) : null;
  }
  if (!from) {
    log.info("no legacy bets, nothing to refresh");
    return;
  }
  // Leave the tail that the policies already cover.
  const plan: { view: string; endOffsetDays: number; stepDays: number }[] = [
    { view: "bets_hourly", endOffsetDays: 3, stepDays: 7 },
    { view: "player_daily", endOffsetDays: 3, stepDays: 7 },
    { view: "bets_daily", endOffsetDays: 7, stepDays: 30 }, // stacked on bets_hourly, so after it
  ];
  for (const p of plan) {
    const end = new Date(Date.now() - p.endOffsetDays * DAY);
    let cur = new Date(Math.floor(from.getTime() / DAY) * DAY);
    let n = 0;
    while (cur < end) {
      const next = new Date(Math.min(cur.getTime() + p.stepDays * DAY, end.getTime()));
      // CALL gives the driver no parameter types, so bind ISO strings rather than Date objects.
      await db.execute(sql`CALL refresh_continuous_aggregate(${sql.raw(`'${p.view}'`)}, ${cur.toISOString()}::timestamptz, ${next.toISOString()}::timestamptz)`);
      n++;
      if (n % 5 === 0) log.info({ view: p.view, through: next.toISOString().slice(0, 10) }, "refreshing");
      cur = next;
      await sleep(opts.pauseMs);
    }
    log.info({ view: p.view, windows: n, from: from.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }, "aggregate refreshed");
  }
}
