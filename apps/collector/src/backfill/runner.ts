import { sql, type Db } from "@casino/db";
import type { Logger } from "pino";
import type { Sink } from "../core/sink.js";
import type { CutoffSpec, Legacy, Source, SourceCtx } from "./types.js";

export type RunOptions = {
  batch: number;
  pauseMs: number;
  /** Legacy rows younger than this are left for the next run so in-flight games have settled. */
  tailMinutes: number;
  maxBatches: number;
  dryRun: boolean;
  /** Overrides every computed cutoff. */
  until: Date | null;
};

export type Deps = { legacy: Legacy; db: Db; sink: Sink; log: Logger; stopRequested: () => boolean };

type Progress = { cursor: bigint; rows_read: number; batches: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadProgress(db: Db, name: string): Promise<Progress> {
  const rows = (await db.execute(sql`SELECT cursor, rows_read, batches FROM backfill_progress WHERE source = ${name}`)) as unknown as Record<string, unknown>[];
  const r = rows[0];
  return r ? { cursor: BigInt(String(r.cursor)), rows_read: Number(r.rows_read), batches: Number(r.batches) } : { cursor: 0n, rows_read: 0, batches: 0 };
}

async function saveProgress(db: Db, name: string, cursor: bigint, rows: number, caughtUp: boolean) {
  await db.execute(sql`
    INSERT INTO backfill_progress (source, cursor, rows_read, batches, caught_up_at)
    VALUES (${name}, ${String(cursor)}, ${rows}, ${rows ? 1 : 0}, ${caughtUp ? sql`now()` : null})
    ON CONFLICT (source) DO UPDATE SET
      cursor       = GREATEST(backfill_progress.cursor, EXCLUDED.cursor),
      rows_read    = backfill_progress.rows_read + EXCLUDED.rows_read,
      batches      = backfill_progress.batches + EXCLUDED.batches,
      updated_at   = now(),
      caught_up_at = COALESCE(EXCLUDED.caught_up_at, backfill_progress.caught_up_at)`);
}

export async function resetProgress(db: Db, names: string[]) {
  await db.execute(sql`DELETE FROM backfill_progress WHERE source IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`);
}

export async function listProgress(db: Db) {
  return (await db.execute(sql`SELECT source, cursor, rows_read, batches, started_at, updated_at, caught_up_at FROM backfill_progress ORDER BY source`)) as unknown as Record<string, unknown>[];
}

/**
 * Earliest row the live collector wrote for this site (and game). Legacy rows
 * carry meta.legacy = true, so anything without it came from the socket feed.
 */
async function computeCutoff(db: Db, site: string, spec: CutoffSpec): Promise<Date | null> {
  const game = spec.game ? sql`AND game = ${spec.game}` : sql``;
  const rows = (await db.execute(sql`
    SELECT min(${sql.raw(spec.col)}) AS t FROM ${sql.raw(spec.table)}
    WHERE site = ${site} ${game} AND (meta IS NULL OR NOT (meta ? 'legacy'))`)) as unknown as { t: string | Date | null }[];
  const t = rows[0]?.t;
  return t ? new Date(t) : null;
}

/** Walk one legacy source from its saved cursor. Returns true when it reached the end. */
export async function runSource(src: Source, opts: RunOptions, deps: Deps): Promise<boolean> {
  const { legacy, db, sink } = deps;
  const log = deps.log.child({ source: src.name });
  const idCol = src.idCol ?? "id";
  const tailCol = src.tailCol ?? "created_at";

  const progress = await loadProgress(db, src.name);
  let cursor = progress.cursor;

  const cutoffs: Record<string, Date | null> = {};
  for (const [key, spec] of Object.entries(src.cutoffs ?? {})) {
    cutoffs[key] = opts.until ?? (await computeCutoff(db, src.site, spec));
  }
  log.info({ cursor: String(cursor), cutoffs, dryRun: opts.dryRun }, "starting");

  const query = `SELECT * FROM ${src.table}
    WHERE ${idCol} > $1 AND ${tailCol} < now() - ($2::int * interval '1 minute')${src.where ? ` AND (${src.where})` : ""}
    ORDER BY ${idCol} LIMIT $3`;

  const ctx: SourceCtx = { legacy, db, sink, log, cutoffs, stats: { emitted: 0, skipped: 0 } };
  let batches = 0;
  let read = 0;
  const started = Date.now();
  const spent = { fetchMs: 0, handleMs: 0, flushMs: 0 };

  for (;;) {
    if (deps.stopRequested()) {
      log.warn("stop requested, cursor saved at last completed batch");
      return false;
    }
    let t = Date.now();
    const rows = (await legacy.unsafe(query, [String(cursor), opts.tailMinutes, opts.batch])) as unknown as Record<string, unknown>[];
    spent.fetchMs += Date.now() - t;
    if (!rows.length) {
      if (!opts.dryRun) await saveProgress(db, src.name, cursor, 0, true);
      log.info({ read, ...ctx.stats, seconds: Math.round((Date.now() - started) / 1000) }, "caught up");
      return true;
    }
    t = Date.now();
    await src.handle(rows, ctx);
    spent.handleMs += Date.now() - t;
    t = Date.now();
    await sink.flush();
    spent.flushMs += Date.now() - t;
    cursor = BigInt(String(rows[rows.length - 1][idCol]));
    read += rows.length;
    batches++;
    if (!opts.dryRun) await saveProgress(db, src.name, cursor, rows.length, false);
    if (batches % 10 === 0 || opts.maxBatches) {
      const secs = (Date.now() - started) / 1000;
      log.info({ cursor: String(cursor), read, ...ctx.stats, rowsPerSec: Math.round(read / Math.max(secs, 1)), ...spent }, "progress");
    }
    if (opts.maxBatches && batches >= opts.maxBatches) {
      log.info({ batches }, "batch limit reached");
      return false;
    }
    if (rows.length < opts.batch) {
      // Short page: we are at the live edge. Mark caught up and stop rather than poll.
      if (!opts.dryRun) await saveProgress(db, src.name, cursor, 0, true);
      log.info({ read, ...ctx.stats }, "caught up");
      return true;
    }
    await sleep(opts.pauseMs);
  }
}
