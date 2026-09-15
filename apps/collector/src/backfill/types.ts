import type postgres from "postgres";
import type { Logger } from "pino";
import type { Db } from "@casino/db";
import type { Sink } from "../core/sink.js";

export type Row = Record<string, any>;
export type Legacy = postgres.Sql;

/** Where, in the new database, live-collector rows for this source would appear. */
export type CutoffSpec = { table: string; col: string; game?: string };

export type SourceCtx = {
  legacy: Legacy;
  db: Db;
  sink: Sink;
  log: Logger;
  /**
   * Per cutoff key: legacy rows whose game time is at or after this instant are
   * skipped because the live collector already owns that period. null = no
   * live data yet, import everything.
   */
  cutoffs: Record<string, Date | null>;
  stats: { emitted: number; skipped: number };
};

export type Source = {
  /** Progress key in backfill_progress. */
  name: string;
  /** Site slug in the new database. */
  site: string;
  /** Legacy table walked in ascending primary-key order. */
  table: string;
  /** Primary key column. Default "id". */
  idCol?: string;
  /** Legacy insert-time column used to leave the newest rows alone until they settle. Default "created_at". */
  tailCol?: string;
  /** Extra SQL for the WHERE clause. */
  where?: string;
  /** Live-data cutoffs to compute before the walk. */
  cutoffs?: Record<string, CutoffSpec>;
  /** Not in the default run set; needs --sources. */
  optIn?: boolean;
  /** Why it is opt-in, or any caveat worth printing in --list. */
  note?: string;
  handle(rows: Row[], ctx: SourceCtx): Promise<void>;
};
